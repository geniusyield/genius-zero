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
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    // Try token pools directly first
    if (unit && unit !== "lovelace") {
      const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/cardano/tokens/${unit}/pools`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        const pool = data?.data?.[0];
        if (pool && pool.attributes?.base_token_price_native_currency) {
          const p = parseFloat(pool.attributes.base_token_price_native_currency);
          if (Number.isFinite(p) && p > 0) {
            clearTimeout(timeout);
            return { provider: "geckoterminal", price: p, timestamp: Date.now() };
          }
        }
      }
    }

    // Fallback to pool search by symbol
    const resSearch = await fetch(
      `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(symbol)}&network=cardano`,
      { headers: { Accept: "application/json" }, signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!resSearch.ok) return null;
    const data = await resSearch.json();
    const pool = data?.data?.[0];
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

// 4. Divergence circuit breaker
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

      const [minswap, dexscreener, gecko] = await Promise.all([
        fetchMinswapPrice(queryUnit),
        fetchDexScreenerPrice(queryUnit),
        fetchGeckoTerminalPrice(queryUnit, querySymbol),
      ]);
      const quotes = [minswap, dexscreener, gecko].filter(Boolean);
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

          const [minswap, dexscreener, gecko] = await Promise.all([
            fetchMinswapPrice(queryUnit),
            fetchDexScreenerPrice(queryUnit),
            fetchGeckoTerminalPrice(queryUnit, querySymbol),
          ]);
          quotes = [minswap, dexscreener, gecko].filter(Boolean);
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
