/**
 * Cardano Immutable Browser Cache
 * 
 * Leverages the deterministic, immutable nature of Cardano's eUTxO model:
 * - Datum hashes are content-addressed: hash(datum) = datumHash. A datum for a given hash NEVER changes.
 * - Transactions (tx_hash) are fixed in history: inputs and outputs never change once mined.
 * - Asset metadata (CIP-25 / CIP-68) is on-chain and immutable.
 * 
 * Stored persistently in browser IndexedDB (allowing gigabytes of storage without localStorage limits).
 */

const DB_NAME = "genius_zero_cardano_cache";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("IndexedDB is not supported in this environment."));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("datums")) {
          db.createObjectStore("datums"); // key: datumHash, value: cborHex string
        }
        if (!db.objectStoreNames.contains("transactions")) {
          db.createObjectStore("transactions"); // key: txHash, value: tx details object
        }
        if (!db.objectStoreNames.contains("tokens")) {
          db.createObjectStore("tokens"); // key: unit, value: TokenInfo
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }

  return dbPromise;
}

/**
 * Generic IndexedDB get
 */
async function getFromStore<T>(storeName: "datums" | "transactions" | "tokens", key: string): Promise<T | null> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Generic IndexedDB set
 */
async function setToStore<T>(storeName: "datums" | "transactions" | "tokens", key: string, value: T): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fail silently on storage errors so core app keeps functioning
  }
}

// --- High Level Typed Accessors ---

/**
 * Resolves a datum by its content hash using local IndexedDB cache first.
 * If not cached, fetches from provider and saves permanently.
 */
export async function getOrFetchDatum(
  datumHash: string,
  fetchFn: () => Promise<string>
): Promise<string> {
  if (!datumHash) return "";

  // 1. Check persistent IndexedDB cache
  const cached = await getFromStore<string>("datums", datumHash);
  if (cached) {
    return cached;
  }

  // 2. Fetch from provider on cache miss
  const freshDatum = await fetchFn();
  if (freshDatum) {
    // 3. Store immutably in IndexedDB
    await setToStore("datums", datumHash, freshDatum);
  }

  return freshDatum;
}

/**
 * Resolves transaction details (e.g. outputs/inputs) using local cache first.
 */
export async function getOrFetchTx<T>(
  txHash: string,
  fetchFn: () => Promise<T>
): Promise<T> {
  if (!txHash) return fetchFn();

  const cached = await getFromStore<T>("transactions", txHash);
  if (cached) {
    return cached;
  }

  const freshTx = await fetchFn();
  if (freshTx) {
    await setToStore("transactions", txHash, freshTx);
  }

  return freshTx;
}

/**
 * Retrieves cache statistics (count of cached items).
 */
export async function getCacheStats(): Promise<{
  datums: number;
  transactions: number;
  tokens: number;
}> {
  try {
    const db = await getDB();
    const countStore = (storeName: string): Promise<number> =>
      new Promise((resolve) => {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(0);
      });

    const [datums, transactions, tokens] = await Promise.all([
      countStore("datums"),
      countStore("transactions"),
      countStore("tokens"),
    ]);

    return { datums, transactions, tokens };
  } catch {
    return { datums: 0, transactions: 0, tokens: 0 };
  }
}

/**
 * Purges the local cache if the user requests a reset.
 */
export async function clearCardanoCache(): Promise<void> {
  try {
    const db = await getDB();
    const clearStore = (storeName: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

    await Promise.all([
      clearStore("datums"),
      clearStore("transactions"),
      clearStore("tokens"),
    ]);
  } catch (err) {
    console.error("Failed to clear Cardano cache:", err);
  }
}
