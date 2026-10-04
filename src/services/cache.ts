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
const DB_VERSION = 2;

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
        if (!db.objectStoreNames.contains("orders")) {
          db.createObjectStore("orders"); // key: `${network}:${txHash}#${outputIndex}`, value: CachedOrderRecord
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
async function getFromStore<T>(storeName: "datums" | "transactions" | "tokens" | "orders", key: string): Promise<T | null> {
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
async function setToStore<T>(storeName: "datums" | "transactions" | "tokens" | "orders", key: string, value: T): Promise<void> {
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

// --- On-Chain Parsed Order Cache Types & Methods ---

export interface ParsedOnChainOrder {
  utxoRef: {
    txHash: string;
    outputIndex: number;
  };
  ownerAddress: string;
  ownerKey: string;
  offeredAsset: string;
  offeredAmount: bigint;
  offeredOriginalAmount: bigint;
  askedAsset: string;
  price: {
    numerator: bigint;
    denominator: bigint;
  };
  nftUnit: string;
  depositLovelace: bigint;
  partialFills: bigint;
  start?: bigint | null;
  end?: bigint | null;
}

export interface CachedOrderRecord {
  network: string;
  txHash: string;
  outputIndex: number;
  ownerAddress: string;
  ownerKey: string;
  offeredAsset: string;
  offeredAmount: string;
  offeredOriginalAmount: string;
  askedAsset: string;
  priceNumerator: string;
  priceDenominator: string;
  nftUnit: string;
  depositLovelace: string;
  partialFills: string;
  start?: string | null;
  end?: string | null;
}

function serializeOrder(network: string, order: ParsedOnChainOrder): CachedOrderRecord {
  return {
    network,
    txHash: order.utxoRef.txHash,
    outputIndex: order.utxoRef.outputIndex,
    ownerAddress: order.ownerAddress,
    ownerKey: order.ownerKey,
    offeredAsset: order.offeredAsset,
    offeredAmount: order.offeredAmount.toString(),
    offeredOriginalAmount: order.offeredOriginalAmount.toString(),
    askedAsset: order.askedAsset,
    priceNumerator: order.price.numerator.toString(),
    priceDenominator: order.price.denominator.toString(),
    nftUnit: order.nftUnit,
    depositLovelace: order.depositLovelace.toString(),
    partialFills: order.partialFills.toString(),
    start: order.start != null ? order.start.toString() : null,
    end: order.end != null ? order.end.toString() : null,
  };
}

function deserializeOrder(record: CachedOrderRecord): ParsedOnChainOrder {
  return {
    utxoRef: {
      txHash: record.txHash,
      outputIndex: record.outputIndex,
    },
    ownerAddress: record.ownerAddress,
    ownerKey: record.ownerKey,
    offeredAsset: record.offeredAsset,
    offeredAmount: BigInt(record.offeredAmount),
    offeredOriginalAmount: BigInt(record.offeredOriginalAmount),
    askedAsset: record.askedAsset,
    price: {
      numerator: BigInt(record.priceNumerator),
      denominator: BigInt(record.priceDenominator),
    },
    nftUnit: record.nftUnit,
    depositLovelace: BigInt(record.depositLovelace),
    partialFills: BigInt(record.partialFills),
    start: record.start != null ? BigInt(record.start) : null,
    end: record.end != null ? BigInt(record.end) : null,
  };
}

/**
 * Retrieves all cached parsed orders for a specific network from IndexedDB.
 */
export async function getCachedOrders(
  network: string
): Promise<Map<string, ParsedOnChainOrder>> {
  const ordersMap = new Map<string, ParsedOnChainOrder>();
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction("orders", "readonly");
      const store = tx.objectStore("orders");
      const range = IDBKeyRange.bound(`${network}:`, `${network}:\uffff`);
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const record = cursor.value as CachedOrderRecord;
          const utxoKey = `${record.txHash}#${record.outputIndex}`;
          try {
            ordersMap.set(utxoKey, deserializeOrder(record));
          } catch (e) {
            console.warn("Failed to deserialize cached order", cursor.key, e);
          }
          cursor.continue();
        } else {
          resolve(ordersMap);
        }
      };
      req.onerror = () => resolve(ordersMap);
    });
  } catch {
    return ordersMap;
  }
}

/**
 * Persists parsed orders to IndexedDB cache.
 */
export async function saveCachedOrders(
  network: string,
  orders: ParsedOnChainOrder[]
): Promise<void> {
  if (orders.length === 0) return;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("orders", "readwrite");
      const store = tx.objectStore("orders");
      for (const order of orders) {
        const key = `${network}:${order.utxoRef.txHash}#${order.utxoRef.outputIndex}`;
        store.put(serializeOrder(network, order), key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fail silently on storage errors
  }
}

/**
 * Prunes cached orders for a network that are no longer in the active on-chain UTxO set.
 */
export async function pruneCachedOrders(
  network: string,
  activeUtxoKeys: Set<string>
): Promise<number> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction("orders", "readwrite");
      const store = tx.objectStore("orders");
      const range = IDBKeyRange.bound(`${network}:`, `${network}:\uffff`);
      const req = store.openCursor(range);
      let prunedCount = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const key = String(cursor.key);
          const utxoKey = key.slice(network.length + 1);
          if (!activeUtxoKeys.has(utxoKey)) {
            cursor.delete();
            prunedCount++;
          }
          cursor.continue();
        } else {
          resolve(prunedCount);
        }
      };
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

/**
 * Retrieves cache statistics (count of cached items).
 */
export async function getCacheStats(): Promise<{
  datums: number;
  transactions: number;
  tokens: number;
  orders: number;
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

    const [datums, transactions, tokens, orders] = await Promise.all([
      countStore("datums"),
      countStore("transactions"),
      countStore("tokens"),
      countStore("orders"),
    ]);

    return { datums, transactions, tokens, orders };
  } catch {
    return { datums: 0, transactions: 0, tokens: 0, orders: 0 };
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
      clearStore("orders"),
    ]);
  } catch (err) {
    console.error("Failed to clear Cardano cache:", err);
  }
}
