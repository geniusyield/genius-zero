/**
 * Genius Zero — Dual-Source Oracle Service & Validation
 *
 * Implements price verification and certificate handling for Genius Yield Liquidity Vaults (DeltaOracle / TWO).
 *
 * Security Principles:
 * 1. DUAL-SOURCE VERIFICATION: Always fetch from at least two independent price feeds
 *    (e.g. Minswap Aggregator + GeckoTerminal / CoinGecko).
 * 2. DIVERGENCE CIRCUIT-BREAKER: If price quotes diverge by more than the configured
 *    threshold (default 5.0%), REFUSE to issue/accept an oracle certificate.
 * 3. FAIL-CLOSED: If either source times out, fails, or has zero liquidity,
 *    REFUSE to issue an oracle certificate (never speculate on single-source data).
 * 4. TESTNET ASSET MAPPING: For Preprod testnet tokens (e.g. tGENS), maps to Mainnet
 *    counterparts to fetch real economic market prices, but re-tags the signed certificate
 *    with the Preprod asset IDs.
 */

import { CML, Constr, Data, fromHex, toHex } from "@lucid-evolution/lucid";
import { NetworkType, TokenInfo, LiquidityVault } from "../types/index";

export interface PriceQuote {
  provider: string;
  price: number; // quote tokens per 1 base token
  timestamp: number;
}

export interface OracleDivergenceCheck {
  approved: boolean;
  divergencePercent: number;
  meanPrice?: number;
  rejectionReason?: string;
  quotes: PriceQuote[];
}

export interface SignedOracleCertificate {
  network: NetworkType;
  baseAsset: {
    policyHex: string;
    tokenHex: string;
  };
  quoteAsset: {
    policyHex: string;
    tokenHex: string;
  };
  price: {
    numerator: bigint;
    denominator: bigint;
    approximateRate: number;
  };
  timestampMs: bigint;
  signatureHex: string;
  oraclePubKeyHex: string;
  cborHex: string;
  quotes?: PriceQuote[];
  divergencePercent?: number;
}

// Canonical asset mapping for Preprod -> Mainnet
export const PREPROD_TO_MAINNET_ASSETS: Record<string, string> = {
  // Preprod tGENS -> Mainnet GENS
  "c6e65ba7878b2f8ea0ad39287d3e2fd256dc5c4160fc19bdf4c4d87e7447454e53":
    "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53",
  // Preprod tADA -> Mainnet ADA
  "lovelace": "lovelace",
};

/**
 * Fetch spot price from Source A: Minswap Aggregator API
 */
export async function fetchMinswapPrice(unit: string): Promise<PriceQuote | null> {
  if (unit === "lovelace" || !unit) {
    return { provider: "minswap", price: 1.0, timestamp: Date.now() };
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
    if (tokenData && typeof tokenData.price_by_ada === "number" && tokenData.price_by_ada > 0) {
      return {
        provider: "minswap",
        price: tokenData.price_by_ada,
        timestamp: Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch spot price from Source B: GeckoTerminal (DexScreener/CoinGecko on-chain pools)
 */
export async function fetchGeckoTerminalPrice(symbol: string): Promise<PriceQuote | null> {
  if (symbol.toUpperCase() === "ADA" || symbol.toUpperCase() === "TADA") {
    return { provider: "geckoterminal", price: 1.0, timestamp: Date.now() };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(symbol)}&network=cardano`,
      {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = await res.json();
    const targetSymbol = symbol.toUpperCase();
    const pool = (data?.data || [])
      .filter((p: any) => {
        const poolName = (p.attributes?.name || "").toUpperCase();
        const [baseSym, quoteSym] = poolName.split("/").map((s: string) => s.trim());
        return baseSym === targetSymbol && (quoteSym === "ADA" || quoteSym === "WADA");
      })
      .sort((a: any, b: any) => parseFloat(b.attributes?.reserve_in_usd || 0) - parseFloat(a.attributes?.reserve_in_usd || 0))[0];

    if (pool && pool.attributes?.base_token_price_native_currency) {
      const price = parseFloat(pool.attributes.base_token_price_native_currency);
      if (Number.isFinite(price) && price > 0) {
        return {
          provider: "geckoterminal",
          price,
          timestamp: Date.now(),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validates price divergence between multiple sources.
 * If divergence > maxAllowedDivergenceRatio, refuses approval.
 */
export function evaluatePriceDivergence(
  quotes: PriceQuote[],
  maxAllowedDivergenceRatio: number = 0.05 // default 5%
): OracleDivergenceCheck {
  if (quotes.length < 2) {
    return {
      approved: false,
      divergencePercent: 100,
      rejectionReason: `Oracle requires at least 2 independent price sources; received ${quotes.length}. Refusing single-source quote.`,
      quotes,
    };
  }

  const prices = quotes.map((q) => q.price).filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length < 2) {
    return {
      approved: false,
      divergencePercent: 100,
      rejectionReason: "One or more price sources returned invalid or non-positive rates.",
      quotes,
    };
  }

  const p1 = prices[0];
  const p2 = prices[1];
  const minP = Math.min(p1, p2);
  const diff = Math.abs(p1 - p2);
  const divergence = minP > 0 ? diff / minP : 1.0;
  const divergencePercent = divergence * 100;

  if (divergence > maxAllowedDivergenceRatio) {
    return {
      approved: false,
      divergencePercent,
      rejectionReason: `Safety alert: Price divergence between ${quotes[0].provider} (${p1.toFixed(6)}) and ${quotes[1].provider} (${p2.toFixed(6)}) is ${divergencePercent.toFixed(2)}%, exceeding maximum safety threshold of ${(maxAllowedDivergenceRatio * 100).toFixed(1)}%.`,
      quotes,
    };
  }

  const meanPrice = (p1 + p2) / 2;
  return {
    approved: true,
    divergencePercent,
    meanPrice,
    quotes,
  };
}

/**
 * Converts a floating point price into an exact reduced rational fraction (numerator / denominator).
 */
export function toExactRational(
  price: number,
  maxDenominator: bigint = 1_000_000n
): { numerator: bigint; denominator: bigint } {
  if (price <= 0 || !Number.isFinite(price)) {
    throw new Error(`Invalid price for rational conversion: ${price}`);
  }

  let hPrev2 = 0n;
  let hPrev1 = 1n;
  let kPrev2 = 1n;
  let kPrev1 = 0n;

  let x = price;
  let bestNum = 1n;
  let bestDen = 1n;
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

/**
 * Builds the PriceTimestamp Plutus Constr struct.
 */
export function buildPriceTimestampConstr(
  basePolicyHex: string,
  baseTokenHex: string,
  quotePolicyHex: string,
  quoteTokenHex: string,
  num: bigint,
  den: bigint,
  timestampMs: bigint
): Constr<any> {
  return new Constr(0, [
    new Constr(0, [basePolicyHex, baseTokenHex]),
    new Constr(0, [quotePolicyHex, quoteTokenHex]),
    new Constr(0, [num, den]),
    timestampMs,
  ]);
}

/**
 * Encodes the PriceTimestamp struct to CBOR hex using Lucid's Data.to.
 */
export function encodePriceTimestampData(
  basePolicyHex: string,
  baseTokenHex: string,
  quotePolicyHex: string,
  quoteTokenHex: string,
  num: bigint,
  den: bigint,
  timestampMs: bigint
): string {
  const pt = buildPriceTimestampConstr(
    basePolicyHex,
    baseTokenHex,
    quotePolicyHex,
    quoteTokenHex,
    num,
    den,
    timestampMs
  );
  return Data.to(pt);
}

/**
 * Signs the PriceTimestamp CBOR bytes with an Ed25519 signing key.
 */
export function signPriceTimestamp(
  priceTimestampCborHex: string,
  privateKeyRawBytesOrHex: string | Uint8Array
): { signatureHex: string; oraclePubKeyHex: string } {
  let rawBytes: Uint8Array;
  if (typeof privateKeyRawBytesOrHex === "string") {
    let hex = privateKeyRawBytesOrHex.trim();
    if (hex.startsWith("5820")) {
      hex = hex.slice(4);
    }
    rawBytes = fromHex(hex);
  } else {
    rawBytes = privateKeyRawBytesOrHex;
  }

  const sk = CML.PrivateKey.from_normal_bytes(rawBytes);
  const pk = sk.to_public();
  const oraclePubKeyHex = toHex(pk.to_raw_bytes());

  const msgBytes = fromHex(priceTimestampCborHex);
  const sig = sk.sign(msgBytes);
  const signatureHex = toHex(sig.to_raw_bytes());

  return { signatureHex, oraclePubKeyHex };
}

/**
 * Issues a fully signed oracle certificate after verifying PriceTimestamp encoding.
 */
export function createSignedOracleCertificate(params: {
  network: NetworkType;
  baseAsset: { policyHex: string; tokenHex: string };
  quoteAsset: { policyHex: string; tokenHex: string };
  price: { numerator: bigint; denominator: bigint; approximateRate: number };
  timestampMs?: bigint;
  oraclePrivateKeyHex: string;
  quotes?: PriceQuote[];
  divergencePercent?: number;
}): SignedOracleCertificate {
  const timestampMs = params.timestampMs ?? BigInt(Date.now());
  const cborHex = encodePriceTimestampData(
    params.baseAsset.policyHex,
    params.baseAsset.tokenHex,
    params.quoteAsset.policyHex,
    params.quoteAsset.tokenHex,
    params.price.numerator,
    params.price.denominator,
    timestampMs
  );

  const { signatureHex, oraclePubKeyHex } = signPriceTimestamp(
    cborHex,
    params.oraclePrivateKeyHex
  );

  return {
    network: params.network,
    baseAsset: params.baseAsset,
    quoteAsset: params.quoteAsset,
    price: params.price,
    timestampMs,
    signatureHex,
    oraclePubKeyHex,
    cborHex,
    quotes: params.quotes,
    divergencePercent: params.divergencePercent,
  };
}

/**
 * Fetches spot prices from Source A (Minswap) & Source B (GeckoTerminal),
 * evaluates divergence (default 5.0%), and returns the rational rate if approved.
 */
export async function fetchDualSourceValidatedPrice(params: {
  unit: string;
  symbol: string;
  maxDivergenceRatio?: number;
}): Promise<{
  approved: boolean;
  rate?: number;
  rational?: { numerator: bigint; denominator: bigint };
  quotes: PriceQuote[];
  rejectionReason?: string;
  divergencePercent?: number;
}> {
  if (params.unit === "lovelace" || params.symbol.toUpperCase() === "ADA") {
    return {
      approved: true,
      rate: 1.0,
      rational: { numerator: 1n, denominator: 1n },
      quotes: [
        { provider: "canonical", price: 1.0, timestamp: Date.now() },
        { provider: "canonical", price: 1.0, timestamp: Date.now() },
      ],
      divergencePercent: 0,
    };
  }

  const targetUnit = PREPROD_TO_MAINNET_ASSETS[params.unit] || params.unit;

  const [minswapQuote, geckoQuote] = await Promise.all([
    fetchMinswapPrice(targetUnit),
    fetchGeckoTerminalPrice(params.symbol),
  ]);

  const quotes: PriceQuote[] = [];
  if (minswapQuote) quotes.push(minswapQuote);
  if (geckoQuote) quotes.push(geckoQuote);

  const check = evaluatePriceDivergence(quotes, params.maxDivergenceRatio ?? 0.05);
  if (!check.approved || typeof check.meanPrice !== "number") {
    return {
      approved: false,
      rejectionReason: check.rejectionReason,
      divergencePercent: check.divergencePercent,
      quotes,
    };
  }

  const rational = toExactRational(check.meanPrice);
  return {
    approved: true,
    rate: check.meanPrice,
    rational,
    quotes,
    divergencePercent: check.divergencePercent,
  };
}

export interface VaultDerivedOraclePrices {
  oracleRate: number; // 1 base in quote (benchmark)
  priceBaseToQuote?: number; // 1 base = X quote (ask/sell rate)
  priceQuoteToBase?: number; // 1 quote = Y base (bid/buy rate)
  spreadStraightPct: number;
  spreadReversePct?: number;
  hasReverse: boolean;
}

/**
 * Calculates current effective prices for an SLV based on live oracle spot rate.
 */
export function calculateVaultOraclePrices(
  vault: LiquidityVault,
  oraclePrice: number
): VaultDerivedOraclePrices | null {
  if (!vault.oracleDelta || oraclePrice <= 0 || !isFinite(oraclePrice)) {
    return null;
  }

  const { isReversed } = vault.canonicalPair;
  const straightSpread = (vault.oracleDelta.straightSpreadPercent ?? 0) / 100;
  const straightOffset = vault.oracleDelta.straightOffset ?? 0;
  const hasReverse = !!vault.oracleDelta.hasReverse;
  const reverseSpread = (vault.oracleDelta.reverseSpreadPercent ?? 0) / 100;
  const reverseOffset = vault.oracleDelta.reverseOffset ?? 0;

  let priceBaseToQuote: number | undefined;
  let priceQuoteToBase: number | undefined;

  if (!isReversed) {
    // Normal orientation: tokenA = Base, tokenB = Quote
    // Straight = Base -> Quote (Ask)
    priceBaseToQuote = oraclePrice * (1 + straightSpread) + straightOffset;
    if (hasReverse) {
      // Reverse = Quote -> Base (Bid)
      const bidBaseInQuote = oraclePrice * (1 - reverseSpread) - reverseOffset;
      if (bidBaseInQuote > 0) {
        priceQuoteToBase = 1 / bidBaseInQuote;
      }
    }
  } else {
    // Reversed orientation: tokenA = Quote, tokenB = Base
    // Straight = Quote -> Base (Bid)
    const bidBaseInQuote = oraclePrice * (1 - straightSpread) - straightOffset;
    if (bidBaseInQuote > 0) {
      priceQuoteToBase = 1 / bidBaseInQuote;
    }
    if (hasReverse) {
      // Reverse = Base -> Quote (Ask)
      priceBaseToQuote = oraclePrice * (1 + reverseSpread) + reverseOffset;
    }
  }

  return {
    oracleRate: oraclePrice,
    priceBaseToQuote: priceBaseToQuote && priceBaseToQuote > 0 ? priceBaseToQuote : undefined,
    priceQuoteToBase: priceQuoteToBase && priceQuoteToBase > 0 ? priceQuoteToBase : undefined,
    spreadStraightPct: vault.oracleDelta.straightSpreadPercent,
    spreadReversePct: vault.oracleDelta.reverseSpreadPercent,
    hasReverse,
  };
}

const oraclePriceCache: Map<string, { price: number; timestamp: number }> = new Map();

/**
 * Fetches the live benchmark oracle price (1 baseToken in quoteToken) using
 * the oracle microservice daemon with client-side dual-source fallback and 30s cache.
 */
export async function fetchLiveOraclePrice(
  network: NetworkType,
  baseToken: TokenInfo,
  quoteToken: TokenInfo
): Promise<number | null> {
  if (baseToken.unit === quoteToken.unit) {
    return 1.0;
  }

  const cacheKey = `${network}:${baseToken.unit}:${quoteToken.unit}`;
  const now = Date.now();
  const cached = oraclePriceCache.get(cacheKey);
  if (cached && now - cached.timestamp < 30_000) {
    return cached.price;
  }

  const getTokenAdaPrice = async (token: TokenInfo): Promise<number | null> => {
    if (
      token.unit === "lovelace" ||
      token.symbol.toUpperCase() === "ADA" ||
      token.symbol.toUpperCase() === "TADA"
    ) {
      return 1.0;
    }

    // 1. Try the oracle microservice daemon
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(
        `https://2.28.204.8.sslip.io/api/v1/oracle/price?network=${network.toLowerCase()}&unit=${token.unit}&symbol=${encodeURIComponent(token.symbol)}`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        if (data.approved && typeof data.meanPrice === "number" && data.meanPrice > 0) {
          return data.meanPrice;
        }
      }
    } catch {
      // Fallback below
    }

    // 2. Fallback to client-side dual-source validation
    try {
      const check = await fetchDualSourceValidatedPrice({
        unit: token.unit,
        symbol: token.symbol,
      });
      if (check.approved && typeof check.rate === "number" && check.rate > 0) {
        return check.rate;
      }
    } catch {
      // ignore
    }

    return null;
  };

  try {
    const [basePriceInAda, quotePriceInAda] = await Promise.all([
      getTokenAdaPrice(baseToken),
      getTokenAdaPrice(quoteToken),
    ]);

    if (basePriceInAda && quotePriceInAda && basePriceInAda > 0 && quotePriceInAda > 0) {
      const priceBaseInQuote = basePriceInAda / quotePriceInAda;
      oraclePriceCache.set(cacheKey, { price: priceBaseInQuote, timestamp: now });
      return priceBaseInQuote;
    }
  } catch (err) {
    console.warn("[Oracle] Failed to resolve live price:", err);
  }

  return null;
}

