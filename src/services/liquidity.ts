import { LucidEvolution, UTxO, Data } from "@lucid-evolution/lucid";
import {
  LiquidityVault,
  NetworkType,
  TokenInfo,
  FetchProgress,
  VaultPricingType,
  LiquidityVaultPrice,
  LiquidityVaultOracleDelta,
  LiquidityVaultRange,
  CanonicalPair,
} from "../types";
import {
  DEX_CONSTANTS,
  ADA_TOKEN,
  TADA_TOKEN,
  DEFAULT_MAINNET_TOKENS,
  DEFAULT_PREPROD_TOKENS,
} from "../config/dex";
import { decodePlutusAddress } from "../contracts/slv";

/**
 * Resolves a token's metadata from its unit (lovelace or policyId + assetNameHex).
 */
export function resolveTokenInfo(
  unit: string,
  customTokens: TokenInfo[] = [],
  network: NetworkType = "mainnet"
): TokenInfo {
  if (unit === "lovelace" || unit === "") {
    return network === "mainnet" ? ADA_TOKEN : TADA_TOKEN;
  }

  // 1. Check custom tokens
  const custom = customTokens.find((t) => t.unit.toLowerCase() === unit.toLowerCase());
  if (custom) return custom;

  // 2. Check default tokens
  const defaults = network === "mainnet" ? DEFAULT_MAINNET_TOKENS : DEFAULT_PREPROD_TOKENS;
  const found = defaults.find((t) => t.unit.toLowerCase() === unit.toLowerCase());
  if (found) return found;

  // 3. Fallback: parse policy ID and asset name hex
  const policyId = unit.slice(0, 56);
  const assetNameHex = unit.slice(56);

  let cleanHex = assetNameHex;
  // Strip common CIP-68 or Genius Yield prefix (e.g. 0014df10) if present
  if (cleanHex.startsWith("0014df10") && cleanHex.length > 8) {
    cleanHex = cleanHex.slice(8);
  }

function hexToUtf8(hex: string): string {
  try {
    let str = "";
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return str;
  } catch {
    return "";
  }
}

  let readableName = "";
  try {
    const raw = hexToUtf8(cleanHex);
    if (/^[\x20-\x7E]+$/.test(raw) && raw.trim().length > 0) {
      readableName = raw.trim();
    }
  } catch {}

  const symbol = readableName || (cleanHex.length > 10 ? cleanHex.slice(0, 6) + "..." : cleanHex || "TOKEN");
  const name = readableName || `Token ${policyId.slice(0, 8)}...`;


  return {
    unit,
    policyId,
    assetName: assetNameHex,
    symbol,
    name,
    decimals: 6, // default standard on Cardano
  };
}

/**
 * Formats a token balance using its decimals.
 */
export function formatTokenAmount(amount: bigint, decimals: number): string {
  if (amount === 0n) return "0";
  const str = amount.toString().padStart(decimals + 1, "0");
  const whole = str.slice(0, str.length - decimals) || "0";
  const frac = str.slice(str.length - decimals).replace(/0+$/, "");
  const formattedWhole = Number(whole).toLocaleString("en-US");
  return frac.length > 0 ? `${formattedWhole}.${frac}` : formattedWhole;
}

/**
 * Formats a numeric price nicely.
 */
export function formatNumericPrice(price: number): string {
  if (price === 0) return "0";
  if (!isFinite(price)) return "∞";
  if (price >= 1000) {
    return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
  } else if (price >= 1) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  } else if (price >= 0.0001) {
    return price.toFixed(6);
  } else {
    return price.toExponential(4);
  }
}

const KNOWN_STABLECOINS = new Set([
  "USDM",
  "DJED",
  "USDC",
  "USDCX",
  "USDA",
  "USDT",
]);

function isAda(token: TokenInfo): boolean {
  return token.unit === "lovelace" || token.symbol === "ADA" || token.symbol === "tADA";
}

function isStable(token: TokenInfo): boolean {
  return KNOWN_STABLECOINS.has(token.symbol.toUpperCase());
}

/**
 * Normalizes a trading pair into a canonical base/quote pair and pairKey
 * to eliminate inverted duplicates (e.g. ADA/GENS and GENS/ADA).
 *
 * Rules:
 * 1. If one token is ADA/tADA and the other is not, ADA is always the quote asset (e.g. GENS / ADA).
 * 2. If one token is a known USD stablecoin and the other is not, the stablecoin is the quote asset (e.g. GENS / USDM).
 * 3. Fallback: alphabetical sort by symbol.
 */
export function getCanonicalPair(tokenA: TokenInfo, tokenB: TokenInfo): CanonicalPair {
  const aIsAda = isAda(tokenA);
  const bIsAda = isAda(tokenB);

  // 1. One is ADA, other is not
  if (aIsAda && !bIsAda) {
    return {
      base: tokenB,
      quote: tokenA,
      pairKey: `${tokenB.symbol} / ${tokenA.symbol}`,
      isReversed: true,
    };
  }
  if (!aIsAda && bIsAda) {
    return {
      base: tokenA,
      quote: tokenB,
      pairKey: `${tokenA.symbol} / ${tokenB.symbol}`,
      isReversed: false,
    };
  }

  // 2. Stablecoins (when neither or both is ADA)
  const aIsStable = isStable(tokenA);
  const bIsStable = isStable(tokenB);

  if (aIsStable && !bIsStable) {
    return {
      base: tokenB,
      quote: tokenA,
      pairKey: `${tokenB.symbol} / ${tokenA.symbol}`,
      isReversed: true,
    };
  }
  if (!aIsStable && bIsStable) {
    return {
      base: tokenA,
      quote: tokenB,
      pairKey: `${tokenA.symbol} / ${tokenB.symbol}`,
      isReversed: false,
    };
  }

  // 3. Alphabetical fallback
  const symA = (tokenA.symbol || "").toUpperCase();
  const symB = (tokenB.symbol || "").toUpperCase();
  if (symA < symB) {
    return {
      base: tokenA,
      quote: tokenB,
      pairKey: `${tokenA.symbol} / ${tokenB.symbol}`,
      isReversed: false,
    };
  } else if (symB < symA) {
    return {
      base: tokenB,
      quote: tokenA,
      pairKey: `${tokenB.symbol} / ${tokenA.symbol}`,
      isReversed: true,
    };
  }

  // Identical symbol fallback: tie-break on unit
  if (tokenA.unit <= tokenB.unit) {
    return {
      base: tokenA,
      quote: tokenB,
      pairKey: `${tokenA.symbol} / ${tokenB.symbol}`,
      isReversed: false,
    };
  } else {
    return {
      base: tokenB,
      quote: tokenA,
      pairKey: `${tokenB.symbol} / ${tokenA.symbol}`,
      isReversed: true,
    };
  }
}

/**
 * Decodes pricing parameters from the SLV inline datum.
 */
export function decodePricing(
  pricing: any,
  tokenA: TokenInfo,
  tokenB: TokenInfo
): {
  pricingType: VaultPricingType;
  fixedPrice?: LiquidityVaultPrice;
  oracleDelta?: LiquidityVaultOracleDelta;
  oracleRange?: LiquidityVaultRange;
} {
  // Field 5 in SLV datum
  if (pricing.index === 0) {
    // Fixed Price: Constr 0 [straight: Rational, reverse: Option<Rational>]
    const num = BigInt(pricing.fields[0].fields[0]);
    const den = BigInt(pricing.fields[0].fields[1]);
    const rawRatio = den > 0n ? Number(num) / Number(den) : 0;

    // rawRatio is units of Token B per unit of Token A (adjusted for decimals)
    const decimalFactor = Math.pow(10, tokenA.decimals - tokenB.decimals);
    const priceAtoB = rawRatio * decimalFactor;
    const priceBtoA = priceAtoB > 0 ? 1 / priceAtoB : 0;

    let hasReverse = false;
    let reversePriceAtoB: number | undefined;
    let reversePriceBtoA: number | undefined;

    // Check if reverse price is set (Option Constr 0 = Some)
    if (pricing.fields[1] && pricing.fields[1].index === 0 && pricing.fields[1].fields?.[0]) {
      const revNum = BigInt(pricing.fields[1].fields[0].fields[0]);
      const revDen = BigInt(pricing.fields[1].fields[0].fields[1]);
      const revRawRatio = revDen > 0n ? Number(revNum) / Number(revDen) : 0;
      // In reverse direction: units of Token A per unit of Token B
      const revDecimalFactor = Math.pow(10, tokenB.decimals - tokenA.decimals);
      reversePriceBtoA = revRawRatio * revDecimalFactor;
      reversePriceAtoB = reversePriceBtoA > 0 ? 1 / reversePriceBtoA : 0;
      hasReverse = true;
    }

    return {
      pricingType: "fixed",
      fixedPrice: {
        priceAtoB,
        priceBtoA,
        formattedAtoB: `1 ${tokenA.symbol} = ${formatNumericPrice(priceAtoB)} ${tokenB.symbol}`,
        formattedBtoA: `1 ${tokenB.symbol} = ${formatNumericPrice(priceBtoA)} ${tokenA.symbol}`,
        hasReverse,
        reversePriceAtoB,
        reversePriceBtoA,
        formattedReverseAtoB: reversePriceAtoB ? `1 ${tokenA.symbol} = ${formatNumericPrice(reversePriceAtoB)} ${tokenB.symbol}` : undefined,
        formattedReverseBtoA: reversePriceBtoA ? `1 ${tokenB.symbol} = ${formatNumericPrice(reversePriceBtoA)} ${tokenA.symbol}` : undefined,
      },
    };
  } else if (pricing.index === 1) {
    // DeltaOracle Dynamic Pricing: Constr 1 [oracle_key: VerificationKey, straight: PriceDelta, reverse: Option<PriceDelta>]
    // PriceDelta = { offset: Rational, spread: Rational }
    // Formula: price = oracle_price * (1 + spread) + offset
    const oracleKey = pricing.fields[0] ? String(pricing.fields[0]) : undefined;

    const offsetNum = BigInt(pricing.fields[1].fields[0].fields[0]);
    const offsetDen = BigInt(pricing.fields[1].fields[0].fields[1]);
    const straightOffset = offsetDen > 0n ? Number(offsetNum) / Number(offsetDen) : 0;

    const spreadNum = BigInt(pricing.fields[1].fields[1].fields[0]);
    const spreadDen = BigInt(pricing.fields[1].fields[1].fields[1]);
    const straightSpreadRatio = spreadDen > 0n ? Number(spreadNum) / Number(spreadDen) : 0;
    const straightSpreadPercent = straightSpreadRatio * 100;

    let hasReverse = false;
    let reverseSpreadPercent: number | undefined;
    let reverseOffset: number | undefined;

    // Check if reverse delta is set (Option Constr 0 = Some)
    if (pricing.fields[2] && pricing.fields[2].index === 0 && pricing.fields[2].fields?.[0]) {
      const revDelta = pricing.fields[2].fields[0];
      const revOffsetNum = BigInt(revDelta.fields[0].fields[0]);
      const revOffsetDen = BigInt(revDelta.fields[0].fields[1]);
      reverseOffset = revOffsetDen > 0n ? Number(revOffsetNum) / Number(revOffsetDen) : 0;

      const revSpreadNum = BigInt(revDelta.fields[1].fields[0]);
      const revSpreadDen = BigInt(revDelta.fields[1].fields[1]);
      const revSpreadRatio = revSpreadDen > 0n ? Number(revSpreadNum) / Number(revSpreadDen) : 0;
      reverseSpreadPercent = revSpreadRatio * 100;
      hasReverse = true;
    }

    const spreadSign = straightSpreadPercent >= 0 ? "+" : "";
    const formattedStraight = `Oracle ${spreadSign}${straightSpreadPercent.toFixed(1)}% spread${
      straightOffset !== 0 ? ` (${straightOffset > 0 ? "+" : ""}${straightOffset})` : ""
    }`;

    const formattedReverse = hasReverse
      ? `Oracle ${(reverseSpreadPercent ?? 0) >= 0 ? "+" : ""}${(reverseSpreadPercent ?? 0).toFixed(1)}% spread${
          (reverseOffset ?? 0) !== 0 ? ` (${(reverseOffset ?? 0) > 0 ? "+" : ""}${reverseOffset})` : ""
        }`
      : undefined;

    return {
      pricingType: "delta_oracle",
      oracleDelta: {
        oracleKey,
        straightSpreadPercent,
        straightOffset,
        hasReverse,
        reverseSpreadPercent,
        reverseOffset,
        formattedStraight,
        formattedReverse,
      },
    };
  }

  return {
    pricingType: "fixed",
  };
}

/**
 * Fetches and parses all active Smart Liquidity Vaults (SLVs) from Cardano.
 */
export async function fetchAllLiquidityVaults(
  lucid: LucidEvolution,
  network: NetworkType,
  customTokens: TokenInfo[] = [],
  userAddresses: string[] = [],
  userPkhs: string[] = [],
  onProgress?: (progress: FetchProgress) => void
): Promise<LiquidityVault[]> {
  const constants = DEX_CONSTANTS[network];
  if (!constants.slvScriptHash) {
    return [];
  }

  onProgress?.({
    current: 0,
    total: 1,
    stage: "Fetching Smart Liquidity Vaults from Cardano...",
    itemType: "Vaults",
  });

  const valCred = {
    type: "Script" as const,
    hash: constants.slvScriptHash,
  };

  const utxos: UTxO[] = await lucid.utxosAt(valCred);

  // Filter for UTxOs containing the SLV tracking NFT
  const vaultUtxos = utxos.filter((utxo) =>
    Object.keys(utxo.assets).some(
      (unit) =>
        unit.startsWith(constants.slvNftPolicyId) &&
        unit.length > constants.slvNftPolicyId.length
    )
  );


  const total = vaultUtxos.length;
  const vaults: LiquidityVault[] = [];
  const normalizedUserPkhs = new Set(userPkhs.map((p) => p.toLowerCase()));
  const normalizedUserAddrs = new Set(userAddresses.map((a) => a.toLowerCase()));

  for (let i = 0; i < total; i++) {
    const utxo = vaultUtxos[i];
    onProgress?.({
      current: i + 1,
      total,
      stage: `Parsing vault ${i + 1} of ${total}...`,
      itemType: "Vaults",
    });

    if (!utxo.datum) continue;

    try {
      const parsed = Data.from(utxo.datum) as any;
      if (!parsed.fields || parsed.fields.length < 6) continue;

      // Owner PKH (fields[0]) & Payment Address (fields[1])
      const ownerKey = String(parsed.fields[0]?.fields?.[0]?.[0] || "");
      const paymentPkh = String(parsed.fields[1]?.fields?.[0]?.fields?.[0] || "");
      let paymentAddr: string | undefined;
      try {
        paymentAddr = decodePlutusAddress(
          parsed.fields[1],
          network === "mainnet" ? "Mainnet" : "Preprod"
        );
      } catch {
        // ignore decode failure
      }

      const isUserVault = Boolean(
        (ownerKey && normalizedUserPkhs.has(ownerKey.toLowerCase())) ||
        (paymentPkh && normalizedUserPkhs.has(paymentPkh.toLowerCase())) ||
        (paymentAddr && normalizedUserAddrs.has(paymentAddr.toLowerCase()))
      );

      // NFT
      const nftTokenName = String(parsed.fields[2] || "");
      const nftUnit = `${constants.slvNftPolicyId}${nftTokenName}`;

      // Token A & Token B assets
      const tA = parsed.fields[3]?.fields?.[0]?.fields || [];
      const tB = parsed.fields[4]?.fields?.[0]?.fields || [];

      const policyA = String(tA[0] || "");
      const nameA = String(tA[1] || "");
      const unitA = policyA === "" && nameA === "" ? "lovelace" : `${policyA}${nameA}`;

      const policyB = String(tB[0] || "");
      const nameB = String(tB[1] || "");
      const unitB = policyB === "" && nameB === "" ? "lovelace" : `${policyB}${nameB}`;

      const tokenA = resolveTokenInfo(unitA, customTokens, network);
      const tokenB = resolveTokenInfo(unitB, customTokens, network);

      // Current on-chain balances inside the UTxO
      const amountA = BigInt(utxo.assets[unitA] || 0);
      const amountB = BigInt(utxo.assets[unitB] || 0);

      const formattedAmountA = formatTokenAmount(amountA, tokenA.decimals);
      const formattedAmountB = formatTokenAmount(amountB, tokenB.decimals);

      // Contained Lovelace Fee (field 8)
      const containedFeeLovelace = parsed.fields[8] ? BigInt(parsed.fields[8]) : 0n;

      // Pricing
      const pricing = parsed.fields[5];
      const { pricingType, fixedPrice, oracleDelta, oracleRange } = decodePricing(pricing, tokenA, tokenB);

      const canonicalPair = getCanonicalPair(tokenA, tokenB);

      vaults.push({
        utxoRef: {
          txHash: utxo.txHash,
          outputIndex: utxo.outputIndex,
        },
        ownerKey,
        isUserVault,
        nftUnit,
        nftTokenName,
        tokenA,
        tokenB,
        amountA,
        amountB,
        formattedAmountA,
        formattedAmountB,
        pricingType,
        fixedPrice,
        oracleDelta,
        oracleRange,
        canonicalPair,
        containedFeeLovelace,
        rawDatumHex: utxo.datum,
      });
    } catch (err) {
      console.warn(`Failed to parse datum for SLV UTxO ${utxo.txHash}#${utxo.outputIndex}:`, err);
    }
  }

  // Sort: user vaults first, then by highest ADA reserve descending
  vaults.sort((a, b) => {
    if (a.isUserVault && !b.isUserVault) return -1;
    if (!a.isUserVault && b.isUserVault) return 1;
    const adaA = getVaultAdaReserve(a);
    const adaB = getVaultAdaReserve(b);
    if (adaA > adaB) return -1;
    if (adaA < adaB) return 1;
    return 0;
  });

  return vaults;
}

/**
 * Returns the ADA reserve (in Lovelace) of a vault regardless of whether ADA is Token A or Token B.
 */
export function getVaultAdaReserve(vault: LiquidityVault): bigint {
  if (vault.tokenA.unit === "lovelace") return vault.amountA;
  if (vault.tokenB.unit === "lovelace") return vault.amountB;
  return 0n;
}


