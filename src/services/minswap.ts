/**
 * Genius Zero — Minswap Market Price Service
 *
 * Fetches spot market rates from Minswap for comparison with on-chain Genius Yield order book prices.
 * Returns prices in both directions:
 * - Base in terms of Quote (e.g., 1 GENS = X ADA)
 * - Quote in terms of Base (e.g., 1 ADA = Y GENS)
 *
 * Uses Minswap's public Aggregator API with CORS support, with in-memory caching to respect rate limits.
 */

import { MinswapPriceInfo, NetworkType, TradingPair } from "../types";

interface CacheEntry {
  data: MinswapPriceInfo;
  timestamp: number;
}

const CACHE_TTL_MS = 30_000; // 30 seconds cache
const priceCache: Map<string, CacheEntry> = new Map();

/**
 * Format token price for display, adapting decimals to value magnitude.
 */
export function formatMinswapRate(price: number): string {
  if (price <= 0 || !isFinite(price) || isNaN(price)) return "—";
  if (price >= 10_000) {
    return price.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  if (price >= 100) {
    return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (price >= 1) {
    return price.toFixed(4);
  }
  if (price >= 0.0001) {
    return price.toFixed(6);
  }
  return price.toExponential(4);
}

/**
 * Fetches a single token's price in ADA via Minswap.
 */
async function fetchTokenPriceInAda(
  unit: string
): Promise<{ priceInAda: number; priceInUsd?: number } | null> {
  if (unit === "lovelace") {
    return { priceInAda: 1 };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch("https://agg-api.minswap.org/aggregator/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: "1000000",
        token_in: "lovelace",
        token_out: unit,
        slippage: 0.01,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = await res.json();
    const tokenData = data?.tokens?.[unit];

    if (
      tokenData &&
      typeof tokenData.price_by_ada === "number" &&
      tokenData.price_by_ada > 0
    ) {
      return {
        priceInAda: tokenData.price_by_ada,
        priceInUsd: tokenData.price_by_usd,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Bridge calculation: derives price between any two tokens via their individual ADA pairs.
 */
async function fetchPriceViaAdaBridge(
  pair: TradingPair,
  now: number
): Promise<MinswapPriceInfo> {
  const baseToken = pair.baseToken;
  const quoteToken = pair.quoteToken;

  const [dataA, dataB] = await Promise.all([
    fetchTokenPriceInAda(baseToken.unit),
    fetchTokenPriceInAda(quoteToken.unit),
  ]);

  if (!dataA || !dataB) {
    return {
      available: false,
      baseSymbol: baseToken.symbol,
      quoteSymbol: quoteToken.symbol,
      priceBaseInQuote: 0,
      priceQuoteInBase: 0,
      lastUpdated: now,
      error: "No active Minswap liquidity pool found for this pair.",
    };
  }

  const priceBaseInQuote = dataA.priceInAda / dataB.priceInAda;
  const priceQuoteInBase = dataB.priceInAda / dataA.priceInAda;

  const result: MinswapPriceInfo = {
    available: true,
    baseSymbol: baseToken.symbol,
    quoteSymbol: quoteToken.symbol,
    priceBaseInQuote,
    priceQuoteInBase,
    baseUsdPrice: dataA.priceInUsd,
    quoteUsdPrice: dataB.priceInUsd,
    lastUpdated: now,
  };

  priceCache.set(`mainnet:${pair.id}`, { data: result, timestamp: now });
  return result;
}

/**
 * Fetches Minswap market price for a given trading pair in both directions.
 */
export async function fetchMinswapPrice(
  pair: TradingPair,
  network: NetworkType = "mainnet"
): Promise<MinswapPriceInfo> {
  const cacheKey = `${network}:${pair.id}`;
  const now = Date.now();

  const cached = priceCache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const baseToken = pair.baseToken;
  const quoteToken = pair.quoteToken;

  // Minswap pool data is only available on Cardano Mainnet
  if (network !== "mainnet") {
    const naResult: MinswapPriceInfo = {
      available: false,
      baseSymbol: baseToken.symbol,
      quoteSymbol: quoteToken.symbol,
      priceBaseInQuote: 0,
      priceQuoteInBase: 0,
      lastUpdated: now,
      error: "Minswap comparison is only available on Mainnet.",
    };
    return naResult;
  }

  const tokenIn = baseToken.unit === "lovelace" ? "lovelace" : baseToken.unit;
  const tokenOut = quoteToken.unit === "lovelace" ? "lovelace" : quoteToken.unit;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    // Call Minswap Aggregator estimate endpoint
    const response = await fetch("https://agg-api.minswap.org/aggregator/estimate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: "1000000",
        token_in: tokenIn,
        token_out: tokenOut,
        slippage: 0.01,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return await fetchPriceViaAdaBridge(pair, now);
    }

    const data = await response.json();
    const tokens = data?.tokens;

    if (!tokens) {
      return await fetchPriceViaAdaBridge(pair, now);
    }

    const baseData = tokens[tokenIn];
    const quoteData = tokens[tokenOut];

    const basePriceInAda = baseData?.price_by_ada;
    const quotePriceInAda = quoteData?.price_by_ada;

    if (
      typeof basePriceInAda !== "number" ||
      typeof quotePriceInAda !== "number" ||
      basePriceInAda <= 0 ||
      quotePriceInAda <= 0
    ) {
      return await fetchPriceViaAdaBridge(pair, now);
    }

    // 1 Base in terms of Quote = basePriceInAda / quotePriceInAda
    const priceBaseInQuote = basePriceInAda / quotePriceInAda;
    // 1 Quote in terms of Base = quotePriceInAda / basePriceInAda
    const priceQuoteInBase = quotePriceInAda / basePriceInAda;

    const result: MinswapPriceInfo = {
      available: true,
      baseSymbol: baseToken.symbol,
      quoteSymbol: quoteToken.symbol,
      priceBaseInQuote,
      priceQuoteInBase,
      baseUsdPrice: baseData.price_by_usd,
      quoteUsdPrice: quoteData.price_by_usd,
      lastUpdated: now,
    };

    priceCache.set(cacheKey, { data: result, timestamp: now });
    return result;
  } catch {
    return await fetchPriceViaAdaBridge(pair, now);
  }
}
