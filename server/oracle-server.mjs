/**
 * Genius Zero — Dual-Source Oracle Microservice Daemon
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
    : "skeys/rewards-owner.skey");

const PREPROD_SKEY_PATH =
  process.env.ORACLE_SKEY_PREPROD ||
  (fs.existsSync("/opt/genius-claim/config/skeys/oracle-preprod.skey")
    ? "/opt/genius-claim/config/skeys/oracle-preprod.skey"
    : "skeys/oracle-preprod.skey");

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
  },
  // TST on preprod -> GENS on mainnet
  "394a0d922bb071b753a4e9e034086ad3b0f533a1e05d0fa851410116545354": {
    mainnetUnit: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53",
    symbol: "GENS",
  },
  "73602cd263925c4e098ffb4e548811d7f4be47076114a4cf8a48efd1545354": {
    mainnetUnit: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53",
    symbol: "GENS",
  },
  "79cb35ac4638bd5b493ee64a91b05d8de7ab0114b729a23f1bdfdce6545354": {
    mainnetUnit: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53",
    symbol: "GENS",
  },
};

// 1. Fetch Minswap
async function fetchMinswapPrice(unit) {
  if (unit === "lovelace" || !unit) {
    return { provider: "minswap", price: 1.0, timestamp: Date.now() };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch("https://agg-api.minswap.org/aggregator/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: "1000000",
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
    if (tokenData && typeof tokenData.price_by_ada === "number" && tokenData.price_by_ada > 0) {
      return { provider: "minswap", price: tokenData.price_by_ada, timestamp: Date.now() };
    }
    return null;
  } catch {
    return null;
  }
}

// 2. Fetch DexScreener
async function fetchDexScreenerPrice(unit) {
  if (unit === "lovelace" || !unit) {
    return { provider: "dexscreener", price: 1.0, timestamp: Date.now() };
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
    const pair = data?.pairs?.find((p) => p.chainId === "cardano");
    if (pair && pair.priceNative) {
      const p = parseFloat(pair.priceNative);
      if (Number.isFinite(p) && p > 0) {
        return { provider: `dexscreener:${pair.dexId || "cardano"}`, price: p, timestamp: Date.now() };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// 3. Fetch GeckoTerminal
async function fetchGeckoTerminalPrice(unit, symbol) {
  if (symbol.toUpperCase() === "ADA" || symbol.toUpperCase() === "TADA") {
    return { provider: "geckoterminal", price: 1.0, timestamp: Date.now() };
  }
  const targetSymbol = (symbol || "").toUpperCase();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    // Try token pools directly first (check unit and CIP-67 unit)
    const candidateUnits = [unit];
    if (unit && unit.length > 56 && !unit.slice(56).startsWith("0014df10")) {
      candidateUnits.push(`${unit.slice(0, 56)}0014df10${unit.slice(56)}`);
    }

    for (const u of candidateUnits) {
      if (u && u !== "lovelace") {
        try {
          const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/cardano/tokens/${u}/pools`, {
            headers: { Accept: "application/json" },
            signal: controller.signal,
          });
          if (res.ok) {
            const data = await res.json();
            const pool = (data?.data || []).find((p) => {
              const poolName = (p.attributes?.name || "").toUpperCase();
              const [baseSym] = poolName.split("/").map((s) => s.trim());
              return baseSym === targetSymbol;
            }) || data?.data?.[0];
            if (pool && pool.attributes?.base_token_price_native_currency) {
              const p = parseFloat(pool.attributes.base_token_price_native_currency);
              if (Number.isFinite(p) && p > 0) {
                clearTimeout(timeout);
                return { provider: "geckoterminal", price: p, timestamp: Date.now() };
              }
            }
          }
        } catch {}
      }
    }

    // Fallback to pool search by symbol, strictly filtering by symbol name and largest liquidity
    const resSearch = await fetch(
      `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(symbol)}&network=cardano`,
      { headers: { Accept: "application/json" }, signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!resSearch.ok) return null;
    const data = await resSearch.json();
    const matchedPools = (data?.data || [])
      .filter((p) => {
        const poolName = (p.attributes?.name || "").toUpperCase();
        const [baseSym, quoteSym] = poolName.split("/").map((s) => s.trim());
        return baseSym === targetSymbol && (quoteSym === "ADA" || quoteSym === "WADA");
      })
      .sort((a, b) => parseFloat(b.attributes?.reserve_in_usd || 0) - parseFloat(a.attributes?.reserve_in_usd || 0));

    const pool = matchedPools[0];
    if (pool && pool.attributes?.base_token_price_native_currency) {
      const p = parseFloat(pool.attributes.base_token_price_native_currency);
      if (Number.isFinite(p) && p > 0) {
        return { provider: "geckoterminal", price: p, timestamp: Date.now() };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function getBlockfrostKey() {
  if (process.env.BLOCKFROST_API_KEY_MAINNET) return process.env.BLOCKFROST_API_KEY_MAINNET;
  if (process.env.BLOCKFROST_KEY) return process.env.BLOCKFROST_KEY;
  const cfgPath = "/opt/genius-claim/config/config.json";
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      return cfg.blockfrostApiKey || cfg.blockfrostKey || null;
    } catch {}
  }
  return "";
}
const BLOCKFROST_MAINNET_KEY = getBlockfrostKey();

// 4. Fetch On-Chain Minswap V2 Pool UTxO via Blockfrost
async function fetchOnChainMinswapPoolPrice(unit) {
  if (unit === "lovelace" || !unit) {
    return { provider: "blockfrost-minswap-v2-onchain", price: 1.0, timestamp: Date.now() };
  }
  if (!BLOCKFROST_MAINNET_KEY) return null;
  const candidateUnits = [unit];
  if (unit.length > 56 && !unit.slice(56).startsWith("0014df10")) {
    candidateUnits.push(`${unit.slice(0, 56)}0014df10${unit.slice(56)}`);
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const poolAddr = "addr1z84q0denmyep98ph3tmzwsmw0j7zau9ljmsqx6a4rvaau66j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq777e2a";
    for (const u of candidateUnits) {
      try {
        const res = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/addresses/${poolAddr}/utxos/${u}`, {
          headers: { project_id: BLOCKFROST_MAINNET_KEY },
          signal: controller.signal,
        });
        if (res.ok) {
          const utxos = await res.json();
          for (const utxo of utxos) {
            const hasFactoryNft = utxo.amount.some((a) => a.unit === "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c4d5350");
            const lovelaceAmt = utxo.amount.find((a) => a.unit === "lovelace")?.quantity;
            const tokenAmt = utxo.amount.find((a) => a.unit === u)?.quantity;
            if (hasFactoryNft && lovelaceAmt && tokenAmt && utxo.amount.length === 4) {
              const p = Number(lovelaceAmt) / Number(tokenAmt);
              if (Number.isFinite(p) && p > 0) {
                clearTimeout(timeout);
                return { provider: "blockfrost-minswap-v2-onchain", price: p, timestamp: Date.now() };
              }
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

// 5. Fetch CoinGecko Tickers
async function fetchCoinGeckoPrice(symbol, unit) {
  const sym = (symbol || "").toUpperCase();
  if (sym === "ADA" || sym === "TADA" || unit === "lovelace") {
    return { provider: "coingecko", price: 1.0, timestamp: Date.now() };
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
      return { provider: "coingecko", price: ticker.last, timestamp: Date.now() };
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

async function getMultiSourceQuotes(queryUnit, querySymbol) {
  const cacheKey = `${queryUnit}:${querySymbol}`;
  const cached = priceCache.get(cacheKey);
  const now = Date.now();

  if (cached && (now - cached.timestamp < CACHE_FRESH_MS) && cached.quotes.length >= 2) {
    return cached.quotes;
  }

  const [minswap, dexscreener, gecko, blockfrost, coingecko] = await Promise.all([
    fetchMinswapPrice(queryUnit),
    fetchDexScreenerPrice(queryUnit),
    fetchGeckoTerminalPrice(queryUnit, querySymbol),
    fetchOnChainMinswapPoolPrice(queryUnit),
    fetchCoinGeckoPrice(querySymbol, queryUnit),
  ]);

  const freshQuotes = [minswap, dexscreener, gecko, blockfrost, coingecko].filter(Boolean);

  if (freshQuotes.length >= 2) {
    priceCache.set(cacheKey, { quotes: freshQuotes, timestamp: now });
    return freshQuotes;
  }

  if (cached && (now - cached.timestamp < CACHE_STALE_MS) && cached.quotes.length >= 2) {
    console.warn(`[OracleServer] Using stale cached quotes (${Math.round((now - cached.timestamp) / 1000)}s old) due to rate-limit/timeout on external APIs.`);
    return cached.quotes;
  }

  if (cached && freshQuotes.length > 0) {
    const providers = new Set(freshQuotes.map(q => q.provider));
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

// 6. Divergence circuit breaker
function evaluateDivergence(quotes, maxDivergenceRatio = 0.05) {
  if (quotes.length < 2) {
    return {
      approved: false,
      divergencePercent: 100,
      rejectionReason: `Oracle requires at least 2 independent price sources; received ${quotes.length}. Refusing single-source quote.`,
      quotes,
    };
  }

  // Find the pair with smallest divergence
  let bestPair = null;
  let minDiv = Infinity;

  for (let i = 0; i < quotes.length; i++) {
    for (let j = i + 1; j < quotes.length; j++) {
      const p1 = quotes[i].price;
      const p2 = quotes[j].price;
      if (!Number.isFinite(p1) || p1 <= 0 || !Number.isFinite(p2) || p2 <= 0) continue;
      const minP = Math.min(p1, p2);
      const diff = Math.abs(p1 - p2);
      const div = minP > 0 ? diff / minP : 1.0;
      if (div < minDiv) {
        minDiv = div;
        bestPair = [quotes[i], quotes[j]];
      }
    }
  }

  if (!bestPair) {
    return {
      approved: false,
      divergencePercent: 100,
      rejectionReason: "No valid positive quotes found from price sources.",
      quotes,
    };
  }

  const divPct = minDiv * 100;
  if (minDiv > maxDivergenceRatio) {
    return {
      approved: false,
      divergencePercent: divPct,
      rejectionReason: `Safety alert: Minimum price divergence between ${bestPair[0].provider} (${bestPair[0].price.toFixed(6)}) and ${bestPair[1].provider} (${bestPair[1].price.toFixed(6)}) is ${divPct.toFixed(2)}%, exceeding maximum threshold of ${(maxDivergenceRatio * 100).toFixed(1)}%.`,
      quotes,
    };
  }

  const mean = (bestPair[0].price + bestPair[1].price) / 2;
  return {
    approved: true,
    divergencePercent: divPct,
    meanPrice: mean,
    concordantSources: [bestPair[0].provider, bestPair[1].provider],
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

function resolveDecimals(unit, symbol, explicitDecimals) {
  if (typeof explicitDecimals === "number" && explicitDecimals >= 0) return explicitDecimals;
  const sym = (symbol || "").toUpperCase();
  if (!unit || unit === "" || unit === "lovelace" || sym === "ADA" || sym === "TADA") return 6;
  if (sym === "GENS" || sym === "TGENS") return 6;
  if (sym === "TST") return 0;
  return 6;
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
        version: "1.0.0",
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

          const quotes = await getMultiSourceQuotes(queryUnit, querySymbol);
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

        const baseDec = resolveDecimals(baseUnit, baseSymbol, payload.baseAsset?.decimals ?? payload.baseDecimals);
        const quoteDec = resolveDecimals(quoteUnit, quoteSymbol, payload.quoteAsset?.decimals ?? payload.quoteDecimals);
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
