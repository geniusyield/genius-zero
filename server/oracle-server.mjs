/**
 * Genius Zero — Multi-Source Oracle Microservice Daemon
 *
 * Runs alongside the claim-server, behind Caddy.
 *
 * Endpoints:
 * - GET  /health or /api/v1/oracle/health
 * - GET  /api/v1/oracle/price?network=...&unit=...&symbol=...
 * - POST /api/v1/oracle/certificate
 */

import http from "http";
import fs from "fs";
import path from "path";
import { CML, Constr, Data, fromHex, toHex } from "@lucid-evolution/lucid";

const PORT = parseInt(process.env.PORT || "8089", 10);
const MAINNET_SKEY_PATH =
  process.env.ORACLE_SKEY_MAINNET ||
  (fs.existsSync("/opt/genius-claim/config/skeys/owner.skey")
    ? "/opt/genius-claim/config/skeys/owner.skey"
    : path.resolve(process.cwd(), "skeys/rewards-owner.skey"));

const PREPROD_SKEY_PATH =
  process.env.ORACLE_SKEY_PREPROD ||
  (fs.existsSync("/opt/genius-claim/config/skeys/oracle-preprod.skey")
    ? "/opt/genius-claim/config/skeys/oracle-preprod.skey"
    : path.resolve(process.cwd(), "skeys/oracle-preprod.skey"));

function loadKey(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[OracleServer] Warning: Key file not found at ${filePath}`);
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    let hex = (raw.cborHex || raw).trim();
    if (hex.startsWith("5820")) hex = hex.slice(4);
    const rawBytes = fromHex(hex);
    const sk = CML.PrivateKey.from_normal_bytes(rawBytes);
    const pk = sk.to_public();
    const pubKeyHex = toHex(pk.to_raw_bytes());
    return { cborHex: hex, pubKeyHex, sk };
  } catch (err) {
    console.error(`[OracleServer] Failed to load key from ${filePath}:`, err);
    return null;
  }
}

const keys = {
  mainnet: loadKey(MAINNET_SKEY_PATH),
  preprod: loadKey(PREPROD_SKEY_PATH),
};

console.log("[OracleServer] Keys loaded:");
console.log(`  Mainnet: ${keys.mainnet ? keys.mainnet.pubKeyHex : "NOT LOADED"}`);
console.log(`  Preprod: ${keys.preprod ? keys.preprod.pubKeyHex : "NOT LOADED"}`);

// Canonical token mapping for testnet
const TESTNET_MAPPINGS = {
  // tGENS (preprod) -> GENS (mainnet)
  "c6e65ba7878b2f8ea0ad39287d3e2fd256dc5c4160fc19bdf4c4d87e7447454e53": {
    mainnetUnit: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53",
    symbol: "GENS",
    decimals: 6,
  },
  // TST on preprod -> GENS on mainnet
  "394a0d922bb071b753a4e9e034086ad3b0f533a1e05d0fa851410116545354": {
    mainnetUnit: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53",
    symbol: "GENS",
    decimals: 0,
  },
  "73602cd263925c4e098ffb4e548811d7f4be47076114a4cf8a48efd1545354": {
    mainnetUnit: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53",
    symbol: "GENS",
    decimals: 0,
  },
  "79cb35ac4638bd5b493ee64a91b05d8de7ab0114b729a23f1bdfdce6545354": {
    mainnetUnit: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53",
    symbol: "GENS",
    decimals: 0,
  },
};

// Curated token decimals by full unit (lowercase)
const KNOWN_UNIT_DECIMALS = {
  "lovelace": 6,
  // 0-decimal tokens
  "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b": 0, // SNEK
  "a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59": 0, // HOSKY
  "c881c20e49dbaca3ff6cef365969354150983230c39520b917f5cf7c4e696b65": 0, // NIKEPIG
  "394a0d922bb071b753a4e9e034086ad3b0f533a1e05d0fa851410116545354": 0, // TST (preprod)
  "73602cd263925c4e098ffb4e548811d7f4be47076114a4cf8a48efd1545354": 0, // TST (preprod)
  "79cb35ac4638bd5b493ee64a91b05d8de7ab0114b729a23f1bdfdce6545354": 0, // TST (preprod)
  // 8-decimal tokens
  "f43a62fdc3965df486de8a0d32fe800963589c41b38946602a0dc53541474958": 8, // AGIX
  "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b6988069425443": 8, // iBTC
  "1ddcb9c9de95361565392c5bdff64767492d61a96166cb16094e54be4f5054": 8, // OPT
  "25f0fc240e91bd95dcdaebd2ba7713fc5168ac77234a3d79449fc20c534f4349455459": 8, // SOC
  "d4fece6b39f7cd78a3f036b2ae6508c13524b863922da80f68dd9ab7414e47454c53": 8, // ANGELS
  "8cfd6893f5f6c1cc954cec1a0a1460841b74da6e7803820dde62bb78524a56": 8, // RJV
  "b6a7467ea1deb012808ef4e87b5ff371e85f7142d7b356a40d9b42a0436f726e75636f70696173205b76696120436861696e506f72742e696f5d": 8, // COPI
  // 9-decimal tokens
  "04b95368393c821f180deee8229fbd941baaf9bd748ebcdbf7adbb147273455247": 9, // rsERG
  // 6-decimal tokens
  "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53": 6, // GENS
  "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb47454e53": 6, // GENS (unprefixed)
  "c6e65ba7878b2f8ea0ad39287d3e2fd256dc5c4160fc19bdf4c4d87e7447454e53": 6, // tGENS
  "fbae99b8679369079a7f6f0da14a2cf1c2d6bfd3afdf3a96a64ab67a0014df1047454e5358": 6, // GENSX
  "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d": 6, // USDM
  "1ecb116ddd0b118b436325054c2e6d2bd803d8f2f801b8793736d5355553444358": 6, // USDCX
  "533bb94a8850ee3ccbe483106489399112b74c905342cb1792a797a0494e4459": 6, // INDY
  "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e": 6, // MIN
  "9a9693a9a37912a5097918f97918d15240c92ab729a0b7c4aa144d7753554e444145": 6, // SUNDAE
  "c0ee29a85b13209423b10447d3c2e6a50641a15c57770e27cb9d507357696e67526964657273": 6, // WRT
  "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61446a65644d6963726f555344": 6, // DJED
  "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd615368656e4d6963726f555344": 6, // SHEN
  "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b6988069555344": 6, // iUSD
  "8fef2d34078659493ce161a6c7fba4b56afefa8535296a5743f6958741414441": 6, // LENFI
  "95a427e384527065f2f8946f5e86320d0117839a5e98ea2c0b55fb0048554e54": 6, // HUNT
  "5d16cc1a177b5d9ba9cfa9793b07e60f1fb70fea1f8aef064415d114494147": 6, // IAG
  "e5a42a1a1d3d1da71b0449663c32798725888d2eb0843c4da4b0e912574d5458": 6, // WMTX
  "edfd7a1d77bcb8b884c474bdc92a16002d1fb720e454fa6e993444794e5458": 6, // NTX
  "577f0b1342f8f8f4aed3388b80a8535812950c7a892495c0ecdf0f1e0014df10464c4454": 6, // FLDT
  "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa4e49474854": 6, // NIGHT
  "5dac8536653edc12f6f5e1045d8164b9f59998d3bdc300fc928434894e4d4b52": 6, // NMKR
  "fd5a192b76cb73f004edde3993c31f8846845d858fa29a19b8a1986948594e": 6, // HYN
  "ececc92aeaa21f5b665f567b01baec8bc2ef71804b4c21716a87a4e353504c415348": 6, // SPLASH
  "804f5544c1962a40546827cab750a88404dc7108c0f588b72964754f56594649": 6, // VYFI
  "f5f8e854af532d828d00381df799ba6db22d825c9b140e1d5795cf850014df10447261676f6e476f6c64": 6, // DG
  "51a5e236c4de3af2b8020442e2a26f454fda3b04cb621c1294a0ef34424f4f4b": 6, // STUFF (BOOK)
  "6c8642400e8437f737eb86df0fc8a8437c760f48592b1ba8f5767e81456d706f7761": 6, // EMP
  "a3931691f5c4e65d01c429e473d0dd24c51afdb6daf88e632a6c1e516f7263666178746f6b656e": 6, // FACT
  "43b075da5317be0cfe2da5cde9ef02a5c32d3b155b9df0eb143fa4004d4e54": 6, // MNT
  "5b26e685cc5c9ad630bde3e3cd48c694436671f3d25df53777ebc60d4e564c": 6, // NVL
  "a2944573e99d2ed3055b808eaa264f0bf119e01fc6b18863067c63e44d454c44": 6, // MELD
  "7f1b689543f91b42a9d3fc8cdffbe7f1f00789e1f849dde1eb7fb2574c494649": 6, // LIFI
  "a4fb5c93ac102eab4cb4eb29f8f3fd2d21e6eeb8b5c2b9321b5c9f15464c4143": 6, // FLAC
  "9abf0afd2f236a19f2842d502d0450cbcd9c79f123a9708f96fd9b96454e4353": 6, // ENCS
  "afbe91c0b44b3040e360057bf8354ead8c49c4979ae6ab7c4fbdc9eb4d494c4b7632": 6, // MILK
};

const KNOWN_SYMBOL_DECIMALS = {
  ADA: 6,
  TADA: 6,
  GENS: 6,
  TGENS: 6,
  GENSX: 6,
  USDM: 6,
  USDCX: 6,
  INDY: 6,
  MIN: 6,
  SUNDAE: 6,
  WRT: 6,
  DJED: 6,
  SHEN: 6,
  IUSD: 6,
  LENFI: 6,
  HUNT: 6,
  IAG: 6,
  WMTX: 6,
  NTX: 6,
  FLDT: 6,
  NIGHT: 6,
  NMKR: 6,
  HYN: 6,
  SPLASH: 6,
  VYFI: 6,
  DG: 6,
  DRAGONGOLD: 6,
  STUFF: 6,
  BOOK: 6,
  EMP: 6,
  FACT: 6,
  MNT: 6,
  NVL: 6,
  MELD: 6,
  LIFI: 6,
  FLAC: 6,
  ENCS: 6,
  MILK: 6,
  SNEK: 0,
  HOSKY: 0,
  NIKEPIG: 0,
  NIKE: 0,
  TST: 0,
  AGIX: 8,
  IBTC: 8,
  OPT: 8,
  SOC: 8,
  ANGELS: 8,
  RJV: 8,
  COPI: 8,
  RSERG: 9,
};

const dynamicDecimalsCache = new Map();

function getBlockfrostKey() {
  if (process.env.BLOCKFROST_API_KEY_MAINNET) return process.env.BLOCKFROST_API_KEY_MAINNET;
  if (process.env.BLOCKFROST_KEY) return process.env.BLOCKFROST_KEY;
  if (process.env.BLOCKFROST_TOKEN) return process.env.BLOCKFROST_TOKEN;
  const candidatePaths = [
    "/opt/genius-claim/config/config.json",
    path.resolve(process.cwd(), "config.json"),
    path.resolve(process.cwd(), "../dex-analysis/config.json"),
  ];
  for (const cfgPath of candidatePaths) {
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
        if (cfg.blockfrostToken) return cfg.blockfrostToken;
        if (cfg.blockfrostApiKey) return cfg.blockfrostApiKey;
        if (cfg.blockfrostKey) return cfg.blockfrostKey;
      } catch {}
    }
  }
  return "";
}
const BLOCKFROST_MAINNET_KEY = getBlockfrostKey();

function resolveDecimalsSync(unit, symbol, explicitDecimals) {
  if (typeof explicitDecimals === "number" && Number.isInteger(explicitDecimals) && explicitDecimals >= 0) {
    return explicitDecimals;
  }
  const u = (unit || "").toLowerCase();
  if (!u || u === "lovelace") return 6;
  if (KNOWN_UNIT_DECIMALS[u] !== undefined) return KNOWN_UNIT_DECIMALS[u];
  if (dynamicDecimalsCache.has(u)) return dynamicDecimalsCache.get(u);
  if (u.length > 56 && !u.slice(56).startsWith("0014df10")) {
    const cip68Unit = `${u.slice(0, 56)}0014df10${u.slice(56)}`;
    if (KNOWN_UNIT_DECIMALS[cip68Unit] !== undefined) return KNOWN_UNIT_DECIMALS[cip68Unit];
    if (dynamicDecimalsCache.has(cip68Unit)) return dynamicDecimalsCache.get(cip68Unit);
  }
  const sym = (symbol || "").toUpperCase();
  if (KNOWN_SYMBOL_DECIMALS[sym] !== undefined) return KNOWN_SYMBOL_DECIMALS[sym];
  return null;
}

async function resolveDecimalsAsync(unit, symbol, explicitDecimals) {
  const syncDec = resolveDecimalsSync(unit, symbol, explicitDecimals);
  if (syncDec !== null) return syncDec;

  const u = (unit || "").toLowerCase();
  const candidateUnits = [u];
  if (u.length > 56 && !u.slice(56).startsWith("0014df10")) {
    candidateUnits.push(`${u.slice(0, 56)}0014df10${u.slice(56)}`);
  }

  // Try Blockfrost asset metadata first
  if (BLOCKFROST_MAINNET_KEY) {
    for (const cand of candidateUnits) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/assets/${cand}`, {
          headers: { project_id: BLOCKFROST_MAINNET_KEY },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          const onchainDec = Number(data?.onchain_metadata?.decimals);
          const offchainDec = Number(data?.metadata?.decimals);
          const isCip68 = String(data?.onchain_metadata_standard || "").startsWith("CIP68");
          const dec = isCip68
            ? (Number.isInteger(onchainDec) && onchainDec >= 0 ? onchainDec : offchainDec)
            : (Number.isInteger(offchainDec) && offchainDec >= 0 ? offchainDec : onchainDec);
          if (Number.isInteger(dec) && dec >= 0) {
            dynamicDecimalsCache.set(u, dec);
            dynamicDecimalsCache.set(cand, dec);
            return dec;
          }
        }
      } catch {}
    }
  }

  // Fallback to CIP-26 Cardano Token Registry
  for (const cand of candidateUnits) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`https://tokens.cardano.org/metadata/${cand}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        const dec = Number(data?.decimals?.value);
        if (Number.isInteger(dec) && dec >= 0) {
          dynamicDecimalsCache.set(u, dec);
          dynamicDecimalsCache.set(cand, dec);
          return dec;
        }
      }
    } catch {}
  }

  return 6;
}

// 1. Fetch Minswap Aggregator
async function fetchMinswapPrice(unit) {
  if (unit === "lovelace" || !unit) {
    return { provider: "minswap", providerGroup: "minswap", venue: "canonical-ada", price: 1.0, timestamp: Date.now() };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch("https://agg-api.minswap.org/aggregator/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: "10000000",
        token_in: "lovelace",
        token_out: unit,
        slippage: 0.05,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const tokenData = data?.tokens?.[unit];
    if (tokenData && typeof tokenData.decimals === "number" && Number.isInteger(tokenData.decimals)) {
      dynamicDecimalsCache.set(unit.toLowerCase(), tokenData.decimals);
    }
    if (tokenData && typeof tokenData.price_by_ada === "number" && tokenData.price_by_ada > 0) {
      return {
        provider: "minswap",
        providerGroup: "minswap",
        venue: "minswap",
        price: tokenData.price_by_ada,
        timestamp: Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// 2. Fetch DexScreener (strictly filtering to ADA-quoted pairs with >= $500 liquidity)
async function fetchDexScreenerPrice(unit) {
  if (unit === "lovelace" || !unit) {
    return { provider: "dexscreener", providerGroup: "dexscreener", venue: "canonical-ada", price: 1.0, timestamp: Date.now() };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${unit}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const targetLower = unit.toLowerCase();
    const validPairs = (data?.pairs || [])
      .filter((p) => {
        if (p.chainId !== "cardano") return false;
        const baseAddr = (p.baseToken?.address || "").toLowerCase();
        const quoteAddr = (p.quoteToken?.address || "").toLowerCase();
        const quoteSym = (p.quoteToken?.symbol || "").toUpperCase();
        const isAdaQuote =
          ["0x", "lovelace", "cardano_0x", ""].includes(quoteAddr) || quoteSym === "ADA";
        const liqUsd = Number(p.liquidity?.usd || 0);
        return baseAddr === targetLower && isAdaQuote && liqUsd >= 500;
      })
      .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));

    const pair = validPairs[0];
    if (pair && pair.priceNative) {
      const p = parseFloat(pair.priceNative);
      if (Number.isFinite(p) && p > 0) {
        const dexId = (pair.dexId || "cardano").toLowerCase();
        return {
          provider: `dexscreener:${dexId}`,
          providerGroup: "dexscreener",
          venue: dexId,
          price: p,
          timestamp: Date.now(),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// 3. Fetch GeckoTerminal (supporting both Token/ADA and inverted ADA/Token pairs, filtering out dust & 0-tx frozen indexers)
async function fetchGeckoTerminalPrice(unit, symbol) {
  if ((symbol || "").toUpperCase() === "ADA" || (symbol || "").toUpperCase() === "TADA" || unit === "lovelace") {
    return { provider: "geckoterminal", providerGroup: "geckoterminal", venue: "canonical-ada", price: 1.0, timestamp: Date.now() };
  }
  const targetSymbol = (symbol || "").toUpperCase();
  const isAdaId = (id) => ["cardano_0x", "cardano_lovelace", "cardano_ada"].includes((id || "").toLowerCase());

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const candidateUnits = [unit];
    if (unit && unit.length > 56 && !unit.slice(56).startsWith("0014df10")) {
      candidateUnits.push(`${unit.slice(0, 56)}0014df10${unit.slice(56)}`);
    }

    for (const u of candidateUnits) {
      if (u && u !== "lovelace") {
        try {
          const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/cardano/tokens/${u}/pools?page=1`, {
            headers: { Accept: "application/json" },
            signal: controller.signal,
          });
          if (res.ok) {
            const data = await res.json();
            const expectedTokenId = `cardano_${u.toLowerCase()}`;
            const candidates = [];

            for (const p of data?.data || []) {
              const attrs = p.attributes || {};
              const rels = p.relationships || {};
              const baseId = (rels.base_token?.data?.id || "").toLowerCase();
              const quoteId = (rels.quote_token?.data?.id || "").toLowerCase();
              const dexId = (rels.dex?.data?.id || "geckoterminal").toLowerCase();
              const reserveUsd = parseFloat(attrs.reserve_in_usd || "0");
              if (!Number.isFinite(reserveUsd) || reserveUsd < 500) continue;

              let priceAda = NaN;
              if (baseId === expectedTokenId && isAdaId(quoteId)) {
                priceAda = parseFloat(attrs.base_token_price_native_currency);
              } else if (quoteId === expectedTokenId && isAdaId(baseId)) {
                // Inverted ADA / Token pool (e.g., ADA / USDM)
                priceAda = parseFloat(attrs.quote_token_price_native_currency);
              }
              if (!Number.isFinite(priceAda) || priceAda <= 0) continue;

              const h24 = attrs.transactions?.h24 || {};
              const tx24h = Number(h24.buys || 0) + Number(h24.sells || 0);
              candidates.push({ priceAda, reserveUsd, tx24h, dexId });
            }

            if (candidates.length > 0) {
              const hasActive = candidates.some((c) => c.tx24h > 0);
              const filtered = hasActive ? candidates.filter((c) => c.tx24h > 0) : candidates;
              filtered.sort((a, b) => b.reserveUsd - a.reserveUsd);
              const best = filtered[0];
              clearTimeout(timeout);
              return {
                provider: "geckoterminal",
                providerGroup: "geckoterminal",
                venue: best.dexId.includes("minswap") ? "minswap" : best.dexId,
                price: best.priceAda,
                timestamp: Date.now(),
              };
            }
          }
        } catch {}
      }
    }

    // Fallback to pool search by symbol, strictly filtering by ADA pair and >= $500 reserve
    const resSearch = await fetch(
      `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(symbol)}&network=cardano`,
      { headers: { Accept: "application/json" }, signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!resSearch.ok) return null;
    const data = await resSearch.json();
    const candidates = [];
    for (const p of data?.data || []) {
      const attrs = p.attributes || {};
      const reserveUsd = parseFloat(attrs.reserve_in_usd || "0");
      if (!Number.isFinite(reserveUsd) || reserveUsd < 500) continue;
      const poolName = (attrs.name || "").toUpperCase();
      const [baseSym, quoteSym] = poolName.split("/").map((s) => s.trim());
      let priceAda = NaN;
      if (baseSym === targetSymbol && (quoteSym === "ADA" || quoteSym === "WADA")) {
        priceAda = parseFloat(attrs.base_token_price_native_currency);
      } else if (quoteSym === targetSymbol && (baseSym === "ADA" || baseSym === "WADA")) {
        priceAda = parseFloat(attrs.quote_token_price_native_currency);
      }
      if (!Number.isFinite(priceAda) || priceAda <= 0) continue;
      const h24 = attrs.transactions?.h24 || {};
      const tx24h = Number(h24.buys || 0) + Number(h24.sells || 0);
      candidates.push({ priceAda, reserveUsd, tx24h });
    }

    if (candidates.length > 0) {
      const hasActive = candidates.some((c) => c.tx24h > 0);
      const filtered = hasActive ? candidates.filter((c) => c.tx24h > 0) : candidates;
      filtered.sort((a, b) => b.reserveUsd - a.reserveUsd);
      return {
        provider: "geckoterminal",
        providerGroup: "geckoterminal",
        venue: "minswap",
        price: filtered[0].priceAda,
        timestamp: Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Generic helper to fetch on-chain pool UTxO reserves via Blockfrost and properly scale by 10^(decimals - 6)
async function fetchOnChainDexPoolPrice({
  unit,
  decimals,
  providerName,
  venueName,
  poolAddr,
  nftPrefixes,
  minLovelace = 1_000_000_000n,
  depositDeductLovelace = 0n,
  exactAmountCount = null,
}) {
  if (unit === "lovelace" || !unit) {
    return { provider: providerName, providerGroup: "blockfrost-onchain", venue: "canonical-ada", price: 1.0, timestamp: Date.now() };
  }
  if (!BLOCKFROST_MAINNET_KEY || typeof decimals !== "number") return null;

  const candidateUnits = [unit];
  if (unit.length > 56 && !unit.slice(56).startsWith("0014df10")) {
    candidateUnits.push(`${unit.slice(0, 56)}0014df10${unit.slice(56)}`);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const decimalScale = Math.pow(10, decimals - 6);

    for (const u of candidateUnits) {
      try {
        const res = await fetch(
          `https://cardano-mainnet.blockfrost.io/api/v0/addresses/${poolAddr}/utxos/${u}?order=desc&count=25`,
          {
            headers: { project_id: BLOCKFROST_MAINNET_KEY },
            signal: controller.signal,
          }
        );
        if (res.ok) {
          const utxos = await res.json();
          let bestLovelace = 0n;
          let bestToken = 0n;

          for (const utxo of utxos) {
            if (exactAmountCount !== null && utxo.amount.length !== exactAmountCount) continue;
            const hasPoolNft = utxo.amount.some((a) =>
              nftPrefixes.some((prefix) => a.unit.startsWith(prefix))
            );
            const lovelaceStr = utxo.amount.find((a) => a.unit === "lovelace")?.quantity;
            const tokenStr = utxo.amount.find((a) => a.unit === u)?.quantity;
            if (!hasPoolNft || !lovelaceStr || !tokenStr) continue;

            const rawLovelace = BigInt(lovelaceStr);
            const lovelaceAmt = rawLovelace > depositDeductLovelace ? rawLovelace - depositDeductLovelace : rawLovelace;
            const tokenAmt = BigInt(tokenStr);
            if (lovelaceAmt >= minLovelace && tokenAmt > 0n && lovelaceAmt > bestLovelace) {
              bestLovelace = lovelaceAmt;
              bestToken = tokenAmt;
            }
          }

          if (bestLovelace > 0n && bestToken > 0n) {
            const atomicRatio = Number(bestLovelace) / Number(bestToken);
            const displayPrice = atomicRatio * decimalScale;
            if (Number.isFinite(displayPrice) && displayPrice > 0) {
              clearTimeout(timeout);
              return {
                provider: providerName,
                providerGroup: "blockfrost-onchain",
                venue: venueName,
                price: displayPrice,
                reserveAda: Number(bestLovelace) / 1e6,
                timestamp: Date.now(),
              };
            }
          }
        }
      } catch {}
    }
    clearTimeout(timeout);
    return null;
  } catch {
    return null;
  }
}

// 4A. Fetch On-Chain Minswap V2 Pool UTxO via Blockfrost
async function fetchOnChainMinswapPoolPrice(unit, decimals) {
  return fetchOnChainDexPoolPrice({
    unit,
    decimals,
    providerName: "blockfrost-minswap-v2-onchain",
    venueName: "minswap-v2",
    poolAddr: "addr1z84q0denmyep98ph3tmzwsmw0j7zau9ljmsqx6a4rvaau66j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq777e2a",
    nftPrefixes: ["f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c"],
    minLovelace: 1_000_000_000n, // >= 1,000 ADA
  });
}

// 4B. Fetch On-Chain Minswap V1 Pool UTxO via Blockfrost
async function fetchOnChainMinswapV1PoolPrice(unit, decimals) {
  return fetchOnChainDexPoolPrice({
    unit,
    decimals,
    providerName: "blockfrost-minswap-v1-onchain",
    venueName: "minswap-v1",
    poolAddr: "addr1z8snz7c4974vzdpxu65ruphl3zjdvtxw8strf2c2tmqnxz2j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq0xmsha",
    nftPrefixes: [
      "e4214b7cce62ac6fbba385d164df48e157eae5863521b4b67ca71d86",
      "13aa2accf2e1561723aa26871e071fdf32c867cff7e7d50ad470d62f",
    ],
    minLovelace: 1_000_000_000n, // >= 1,000 ADA (rejects deprecated <1,000 ADA V1 remnant pools)
  });
}

// 4C. Fetch On-Chain SundaeSwap V3 Pool UTxO via Blockfrost
async function fetchOnChainSundaeSwapV3PoolPrice(unit, decimals) {
  return fetchOnChainDexPoolPrice({
    unit,
    decimals,
    providerName: "blockfrost-sundaeswap-v3-onchain",
    venueName: "sundaeswap",
    poolAddr: "addr1z8srqftqemf0mjlukfszd97ljuxdp44r372txfcr75wrz2auzrlrz2kdd83wzt9u9n9qt2swgvhrmmn96k55nq6yuj4qw992w9",
    nftPrefixes: ["e0302560ced2fdcbfcb2602697df970cd0d6a38f94b32703f51c312b000de140"],
    minLovelace: 1_000_000_000n, // >= 1,000 ADA
  });
}

// 4D. Fetch On-Chain SundaeSwap V1 Pool UTxO via Blockfrost
async function fetchOnChainSundaeSwapV1PoolPrice(unit, decimals) {
  return fetchOnChainDexPoolPrice({
    unit,
    decimals,
    providerName: "blockfrost-sundaeswap-v1-onchain",
    venueName: "sundaeswap-v1",
    poolAddr: "addr1w9qzpelu9hn45pefc0xr4ac4kdxeswq7pndul2vuj59u8tqaxdznu",
    nftPrefixes: ["0029cb7c88c7567b63d1a512c0ed626aa169688ec980730c0473b913"],
    minLovelace: 1_000_000_000n, // >= 1,000 ADA
  });
}

// 4E. Fetch On-Chain WingRiders V2 Pool UTxO via Blockfrost
async function fetchOnChainWingRidersV2PoolPrice(unit, decimals) {
  return fetchOnChainDexPoolPrice({
    unit,
    decimals,
    providerName: "blockfrost-wingriders-v2-onchain",
    venueName: "wingriders-v2",
    poolAddr: "script147thjwu8qtecr9mvajp7xqlfecths9zccu7yhvt0uq4cxrg3w6r",
    nftPrefixes: ["6fdc63a1d71dc2c65502b79baae7fb543185702b12c3c5fb639ed7374c"],
    minLovelace: 800_000_000n, // >= 800 ADA
    depositDeductLovelace: 3_000_000n,
    exactAmountCount: 4,
  });
}

// 4F. Fetch On-Chain WingRiders V1 Pool UTxO via Blockfrost
async function fetchOnChainWingRidersV1PoolPrice(unit, decimals) {
  return fetchOnChainDexPoolPrice({
    unit,
    decimals,
    providerName: "blockfrost-wingriders-v1-onchain",
    venueName: "wingriders-v1",
    poolAddr: "script1umys5kfrwya027rfv00wpl0lmqcv5lsvs6syrk09svlfzwn6pvf",
    nftPrefixes: ["026a18d04a0c642759bb3d83b12e3344894e5c1c7b2aeb1a2113a5704c"],
    minLovelace: 400_000_000n, // >= 400 ADA
    depositDeductLovelace: 3_000_000n,
    exactAmountCount: 4,
  });
}

// 5. Fetch CoinGecko Tickers
async function fetchCoinGeckoPrice(symbol, unit) {
  const sym = (symbol || "").toUpperCase();
  if (sym === "ADA" || sym === "TADA" || unit === "lovelace") {
    return { provider: "coingecko", providerGroup: "coingecko", venue: "canonical-ada", price: 1.0, timestamp: Date.now() };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    let coinId = null;
    if (sym === "GENS" || sym === "TGENS") {
      coinId = "genius-yield";
    } else if (sym === "MIN") {
      coinId = "minswap";
    } else if (sym === "SNEK") {
      coinId = "snek";
    } else if (sym === "INDY") {
      coinId = "indigo-protocol";
    } else if (sym === "IAG") {
      coinId = "iagon";
    } else if (sym === "AGIX") {
      coinId = "singularitynet";
    } else if (sym === "USDM") {
      coinId = "usdm-2";
    }

    if (!coinId) {
      const sRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(sym)}`, {
        signal: controller.signal,
      });
      if (sRes.ok) {
        const sData = await sRes.json();
        coinId = sData?.coins?.[0]?.id;
      }
    }
    if (!coinId) {
      clearTimeout(timeout);
      return null;
    }

    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/tickers`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const ticker = data?.tickers?.find(
      (t) => (t.target === "0X" || t.target === "ADA" || t.target === "WADA") && t.last > 0
    );
    if (ticker && typeof ticker.last === "number" && ticker.last > 0) {
      return {
        provider: "coingecko",
        providerGroup: "coingecko",
        venue: "coingecko",
        price: ticker.last,
        timestamp: Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// In-memory cache for multi-source quotes
const priceCache = new Map();
const CACHE_FRESH_MS = 45_000; // 45 seconds fresh
const CACHE_STALE_MS = 300_000; // 5 minutes stale grace

async function getMultiSourceQuotes(queryUnit, querySymbol, explicitDecimals) {
  const cacheKey = `${queryUnit}:${querySymbol}`;
  const cached = priceCache.get(cacheKey);
  const now = Date.now();

  if (cached && (now - cached.timestamp < CACHE_FRESH_MS) && cached.quotes.length >= 2) {
    return cached.quotes;
  }

  const decimals = await resolveDecimalsAsync(queryUnit, querySymbol, explicitDecimals);

  const [
    minswapRaw,
    dexscreener,
    gecko,
    blockfrostV2,
    blockfrostV1,
    sundaeV3,
    sundaeV1,
    wingridersV2,
    wingridersV1,
    coingecko,
  ] = await Promise.all([
    fetchMinswapPrice(queryUnit),
    fetchDexScreenerPrice(queryUnit),
    fetchGeckoTerminalPrice(queryUnit, querySymbol),
    fetchOnChainMinswapPoolPrice(queryUnit, decimals),
    fetchOnChainMinswapV1PoolPrice(queryUnit, decimals),
    fetchOnChainSundaeSwapV3PoolPrice(queryUnit, decimals),
    fetchOnChainSundaeSwapV1PoolPrice(queryUnit, decimals),
    fetchOnChainWingRidersV2PoolPrice(queryUnit, decimals),
    fetchOnChainWingRidersV1PoolPrice(queryUnit, decimals),
    fetchCoinGeckoPrice(querySymbol, queryUnit),
  ]);

  // If Minswap's /aggregator/tokens endpoint is echoing a deprecated <1,000 ADA V1 pool
  // (i.e. blockfrostV1 is null, blockfrostV2 >= 1,000 ADA exists, and minswapRaw diverges >5% from blockfrostV2),
  // prefer the deep Minswap V2 pool over the stale V1 aggregator ticker.
  const minswap =
    minswapRaw &&
    blockfrostV2 &&
    !blockfrostV1 &&
    Math.abs(minswapRaw.price - blockfrostV2.price) / Math.min(minswapRaw.price, blockfrostV2.price) > 0.05
      ? null
      : minswapRaw;

  const freshQuotes = [
    minswap,
    dexscreener,
    gecko,
    blockfrostV2,
    blockfrostV1,
    sundaeV3,
    sundaeV1,
    wingridersV2,
    wingridersV1,
    coingecko,
  ].filter(Boolean);

  if (freshQuotes.length >= 2) {
    priceCache.set(cacheKey, { quotes: freshQuotes, timestamp: now });
    return freshQuotes;
  }

  if (cached && (now - cached.timestamp < CACHE_STALE_MS) && cached.quotes.length >= 2) {
    console.warn(`[OracleServer] Using stale cached quotes (${Math.round((now - cached.timestamp) / 1000)}s old) due to rate-limit/timeout on external APIs.`);
    return cached.quotes;
  }

  if (cached && freshQuotes.length > 0) {
    const providers = new Set(freshQuotes.map((q) => q.provider));
    const merged = [...freshQuotes];
    for (const cq of cached.quotes) {
      if (!providers.has(cq.provider)) {
        merged.push(cq);
      }
    }
    if (merged.length >= 2) {
      priceCache.set(cacheKey, { quotes: merged, timestamp: now });
      return merged;
    }
  }

  return freshQuotes;
}

function inferProviderGroup(q) {
  if (q.providerGroup) return q.providerGroup;
  const p = (q.provider || "").toLowerCase();
  if (p.startsWith("blockfrost-")) return "blockfrost-onchain";
  if (p.startsWith("dexscreener")) return "dexscreener";
  if (p.startsWith("geckoterminal")) return "geckoterminal";
  if (p.startsWith("coingecko")) return "coingecko";
  if (p.startsWith("minswap")) return "minswap";
  return p;
}

function computeMedian(sortedNums) {
  const n = sortedNums.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sortedNums[mid] : (sortedNums[mid - 1] + sortedNums[mid]) / 2;
}

// 6. Consensus & divergence circuit breaker across independent provider groups
function evaluateDivergence(quotes, maxDivergenceRatio = 0.05) {
  const validQuotes = (quotes || []).filter(
    (q) => Number.isFinite(q.price) && q.price > 0
  );

  if (validQuotes.length < 2) {
    return {
      approved: false,
      divergencePercent: 100,
      rejectionReason: `Oracle requires at least 2 valid price quotes; received ${validQuotes.length}. Refusing single-source quote.`,
      quotes,
    };
  }

  const allGroups = new Set(validQuotes.map(inferProviderGroup));
  if (allGroups.size < 2) {
    return {
      approved: false,
      divergencePercent: 100,
      rejectionReason: `Oracle requires at least 2 independent provider families; all ${validQuotes.length} quotes came from '${[...allGroups][0]}'.`,
      quotes,
    };
  }

  const sortedPrices = validQuotes.map((q) => q.price).sort((a, b) => a - b);
  const medianPrice = computeMedian(sortedPrices);
  const totalMin = sortedPrices[0];
  const totalMax = sortedPrices[sortedPrices.length - 1];
  const totalSpreadPct = totalMin > 0 ? ((totalMax - totalMin) / totalMin) * 100 : 100;

  // Greedily build the concordant cluster outward from the median while keeping
  // both individual deviation from median and total cluster spread within maxDivergenceRatio
  const candidatesByDist = validQuotes
    .filter((q) => Math.abs(q.price - medianPrice) / Math.min(q.price, medianPrice) <= maxDivergenceRatio)
    .sort((a, b) => Math.abs(a.price - medianPrice) - Math.abs(b.price - medianPrice));

  const concordant = [];
  let cMin = Infinity;
  let cMax = -Infinity;
  for (const q of candidatesByDist) {
    const nextMin = Math.min(cMin, q.price);
    const nextMax = Math.max(cMax, q.price);
    const nextSpread = nextMin > 0 ? (nextMax - nextMin) / nextMin : 1.0;
    if (concordant.length === 0 || nextSpread <= maxDivergenceRatio) {
      concordant.push(q);
      cMin = nextMin;
      cMax = nextMax;
    }
  }
  const concordantGroups = new Set(concordant.map(inferProviderGroup));

  if (concordant.length >= 2 && concordantGroups.size >= 2) {
    const cPrices = concordant.map((q) => q.price).sort((a, b) => a - b);
    const clusterSpreadRatio = cMin > 0 ? (cMax - cMin) / cMin : 1.0;
    const consensusMedian = computeMedian(cPrices);
    const cMean = cPrices.reduce((acc, v) => acc + v, 0) / cPrices.length;
    const divPct = clusterSpreadRatio * 100;
    return {
      approved: true,
      divergencePercent: divPct,
      totalSpreadPercent: totalSpreadPct,
      meanPrice: consensusMedian,
      arithmeticMeanPrice: cMean,
      concordantSources: concordant.map((q) => q.provider),
      independentProviderCount: concordantGroups.size,
      quotes,
    };
  }

  // Fallback: find the tightest pair across DISTINCT independent provider groups,
  // provided its midpoint is also consistent with the overall median
  let bestPair = null;
  let minCrossGroupDiv = Infinity;

  for (let i = 0; i < validQuotes.length; i++) {
    for (let j = i + 1; j < validQuotes.length; j++) {
      if (inferProviderGroup(validQuotes[i]) === inferProviderGroup(validQuotes[j])) {
        continue;
      }
      const p1 = validQuotes[i].price;
      const p2 = validQuotes[j].price;
      const minP = Math.min(p1, p2);
      const div = Math.abs(p1 - p2) / minP;
      if (div < minCrossGroupDiv) {
        minCrossGroupDiv = div;
        bestPair = [validQuotes[i], validQuotes[j]];
      }
    }
  }

  if (!bestPair) {
    return {
      approved: false,
      divergencePercent: 100,
      rejectionReason: "No cross-provider quote pairs available for verification.",
      quotes,
    };
  }

  const divPct = minCrossGroupDiv * 100;
  const pairMean = (bestPair[0].price + bestPair[1].price) / 2;
  const medianDrift = Math.abs(pairMean - medianPrice) / Math.min(pairMean, medianPrice);

  if (minCrossGroupDiv > maxDivergenceRatio || medianDrift > maxDivergenceRatio) {
    return {
      approved: false,
      divergencePercent: Math.max(divPct, totalSpreadPct),
      totalSpreadPercent: totalSpreadPct,
      rejectionReason: `Safety alert: Price spread across independent sources is ${totalSpreadPct.toFixed(2)}% (best cross-provider pair ${bestPair[0].provider}=${bestPair[0].price.toFixed(6)} vs ${bestPair[1].provider}=${bestPair[1].price.toFixed(6)}, diff ${divPct.toFixed(2)}%), exceeding threshold of ${(maxDivergenceRatio * 100).toFixed(1)}%.`,
      quotes,
    };
  }

  return {
    approved: true,
    divergencePercent: divPct,
    totalSpreadPercent: totalSpreadPct,
    meanPrice: pairMean,
    concordantSources: [bestPair[0].provider, bestPair[1].provider],
    independentProviderCount: 2,
    quotes,
  };
}

// 4. Continued fraction toExactRational
function toExactRational(price, maxDenominator = 1_000_000n) {
  if (price <= 0 || !Number.isFinite(price)) {
    throw new Error(`Invalid price for rational conversion: ${price}`);
  }
  let hPrev2 = 0n, hPrev1 = 1n;
  let kPrev2 = 1n, kPrev1 = 0n;
  let x = price;
  let bestNum = 1n, bestDen = 1n;
  let bestDiff = Math.abs(Number(bestNum) / Number(bestDen) - price);

  for (let iter = 0; iter < 20; iter++) {
    const a = BigInt(Math.floor(x));
    const h = a * hPrev1 + hPrev2;
    const k = a * kPrev1 + kPrev2;
    if (k > maxDenominator) break;
    if (k > 0n) {
      const currentDiff = Math.abs(Number(h) / Number(k) - price);
      if (currentDiff < bestDiff) {
        bestNum = h;
        bestDen = k;
        bestDiff = currentDiff;
      }
    }
    hPrev2 = hPrev1;
    hPrev1 = h;
    kPrev2 = kPrev1;
    kPrev1 = k;
    if (Math.abs(x - Number(a)) < 1e-12) break;
    x = 1 / (x - Number(a));
    if (!Number.isFinite(x) || x > 1e14) break;
  }
  return { numerator: bestNum, denominator: bestDen };
}

// 5. Encoding & Signing
function encodePriceTimestampData(basePolicyHex, baseTokenHex, quotePolicyHex, quoteTokenHex, num, den, timestampMs) {
  const pt = new Constr(0, [
    new Constr(0, [basePolicyHex, baseTokenHex]),
    new Constr(0, [quotePolicyHex, quoteTokenHex]),
    new Constr(0, [num, den]),
    timestampMs,
  ]);
  return Data.to(pt);
}

function signCertificate(sk, cborHex) {
  const msgBytes = fromHex(cborHex);
  const sig = sk.sign(msgBytes);
  return toHex(sig.to_raw_bytes());
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // Health
  if (pathname === "/health" || pathname === "/api/v1/oracle/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "genius-oracle",
        version: "1.1.0",
        timestamp: Date.now(),
        keys: {
          mainnet: keys.mainnet?.pubKeyHex || null,
          preprod: keys.preprod?.pubKeyHex || null,
        },
      })
    );
    return;
  }

  // Price query
  if (pathname === "/api/v1/oracle/price" && req.method === "GET") {
    try {
      const network = parsedUrl.searchParams.get("network") || "mainnet";
      const unit = parsedUrl.searchParams.get("unit") || "";
      const symbol = parsedUrl.searchParams.get("symbol") || "GENS";
      const maxDivParam = parsedUrl.searchParams.get("maxDivergenceRatio") || parsedUrl.searchParams.get("maxDivergence");
      const maxDiv = maxDivParam ? parseFloat(maxDivParam) : 0.10;

      let queryUnit = unit;
      let querySymbol = symbol;
      if (network === "preprod" && TESTNET_MAPPINGS[unit]) {
        queryUnit = TESTNET_MAPPINGS[unit].mainnetUnit;
        querySymbol = TESTNET_MAPPINGS[unit].symbol;
      }

      const quotes = await getMultiSourceQuotes(queryUnit, querySymbol);
      const evalResult = evaluateDivergence(quotes, maxDiv);

      res.writeHead(evalResult.approved ? 200 : 422, { "Content-Type": "application/json" });
      res.end(JSON.stringify(evalResult));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message || String(err) }));
    }
    return;
  }

  // Certificate signing
  if (pathname === "/api/v1/oracle/certificate" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const network = (payload.network || "mainnet").toLowerCase();
        const basePolicyHex = payload.baseAsset?.policyHex || "";
        const baseTokenHex = payload.baseAsset?.tokenHex || "";
        const quotePolicyHex = payload.quoteAsset?.policyHex || "";
        const quoteTokenHex = payload.quoteAsset?.tokenHex || "";
        const baseUnit = basePolicyHex ? `${basePolicyHex}${baseTokenHex}` : "lovelace";
        const quoteUnit = quotePolicyHex ? `${quotePolicyHex}${quoteTokenHex}` : "lovelace";
        const isBaseAda = !basePolicyHex || basePolicyHex === "" || basePolicyHex === "lovelace";
        const isQuoteAda = !quotePolicyHex || quotePolicyHex === "" || quotePolicyHex === "lovelace";

        const baseSymbol = payload.baseAsset?.symbol || (isBaseAda ? "ADA" : (payload.symbol || "GENS"));
        const quoteSymbol = payload.quoteAsset?.symbol || (isQuoteAda ? "ADA" : (payload.symbol || "GENS"));
        const maxDiv = payload.maxDivergenceRatio ?? 0.10; // Default 10% divergence circuit-breaker

        const keyObj = keys[network];
        if (!keyObj) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Signing key not available for network: ${network}` }));
          return;
        }

        let rate; // Human exchange rate: Quote tokens per 1 Base token
        let quotes = [];
        let divPct = 0;

        if (payload.overridePrice != null && Number.isFinite(payload.overridePrice) && payload.overridePrice > 0) {
          // Manual/test rate
          rate = payload.overridePrice;
          quotes = [{ provider: "manual-override", price: rate, timestamp: Date.now() }];
        } else {
          // Determine which token to query against ADA
          let queryUnit;
          let querySymbol;
          let invertRate = false;

          if (isBaseAda && !isQuoteAda) {
            // Base is ADA, Quote is Token.
            // Query Token market price in ADA, then rate = 1 / tokenPriceInAda
            queryUnit = quoteUnit;
            querySymbol = quoteSymbol;
            invertRate = true;
          } else {
            // Base is Token, Quote is ADA (or Token A to Token B)
            queryUnit = baseUnit;
            querySymbol = baseSymbol;
            invertRate = false;
          }

          if (network === "preprod" && TESTNET_MAPPINGS[queryUnit]) {
            querySymbol = TESTNET_MAPPINGS[queryUnit].symbol;
            queryUnit = TESTNET_MAPPINGS[queryUnit].mainnetUnit;
          }

          quotes = await getMultiSourceQuotes(queryUnit, querySymbol);
          const evalRes = evaluateDivergence(quotes, maxDiv);
          if (!evalRes.approved) {
            res.writeHead(422, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                approved: false,
                rejectionReason: evalRes.rejectionReason,
                divergencePercent: evalRes.divergencePercent,
                quotes,
              })
            );
            return;
          }
          const spotAdaPrice = evalRes.meanPrice;
          rate = invertRate ? (spotAdaPrice > 0 ? 1 / spotAdaPrice : 0) : spotAdaPrice;
          divPct = evalRes.divergencePercent;
        }

        const baseDec = await resolveDecimalsAsync(baseUnit, baseSymbol, payload.baseAsset?.decimals ?? payload.baseDecimals);
        const quoteDec = await resolveDecimalsAsync(quoteUnit, quoteSymbol, payload.quoteAsset?.decimals ?? payload.quoteDecimals);
        const decimalFactor = Math.pow(10, quoteDec - baseDec);
        const effectiveAtomicPrice = rate * decimalFactor;
        const rational = toExactRational(effectiveAtomicPrice);
        const timestampMs = BigInt(payload.timestampMs || Date.now());

        const cborHex = encodePriceTimestampData(
          basePolicyHex,
          baseTokenHex,
          quotePolicyHex,
          quoteTokenHex,
          rational.numerator,
          rational.denominator,
          timestampMs
        );

        const signatureHex = signCertificate(keyObj.sk, cborHex);

        const responseObj = {
          approved: true,
          network,
          baseAsset: { policyHex: basePolicyHex, tokenHex: baseTokenHex },
          quoteAsset: { policyHex: quotePolicyHex, tokenHex: quoteTokenHex },
          price: {
            numerator: rational.numerator.toString(),
            denominator: rational.denominator.toString(),
            approximateRate: rate,
          },
          timestampMs: Number(timestampMs),
          oraclePubKeyHex: keyObj.pubKeyHex,
          signatureHex,
          cborHex,
          quotes,
          divergencePercent: divPct,
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(responseObj));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || String(err) }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Endpoint not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[OracleServer] Running on http://127.0.0.1:${PORT}`);
});
