import { LucidEvolution, UTxO } from "@lucid-evolution/lucid";
import {
  DexOrder,
  NetworkType,
  OrderBook,
  TradingPair,
  FetchProgress,
  RationalPrice,
  LiquidityVault,
} from "../types";
import { DEX_CONSTANTS } from "../config/dex";
import { myDatumOf } from "../contracts/api";
import { assetClassDToUnit, toAddress } from "../contracts/utils";
import { PartialOrderDatum } from "../contracts/contract.types";
import { runWithConcurrency } from "./staking";
import {
  ParsedOnChainOrder,
  getCachedOrders,
  saveCachedOrders,
  pruneCachedOrders,
} from "./cache";
export type { ParsedOnChainOrder };
import { fetchAllLiquidityVaults } from "./liquidity";
import { toExactRational } from "./oracle";
import { fetchMinswapPrice } from "./minswap";

/**
 * Fetches all active parsed orders for the network, using the local IndexedDB cache
 * to avoid re-fetching and re-parsing immutable on-chain order UTxOs.
 * Also prunes spent/filled/cancelled orders from the cache.
 */
export async function fetchAllActiveParsedOrders(
  lucid: LucidEvolution,
  network: NetworkType,
  onProgress?: (progress: FetchProgress) => void,
  abortSignal?: { aborted: boolean }
): Promise<ParsedOnChainOrder[]> {
  const constants = DEX_CONSTANTS[network];
  const valCred = {
    type: "Script" as const,
    hash: constants.valCredHash,
  };

  onProgress?.({
    current: 0,
    total: 1,
    stage: "Fetching UTxOs at DEX order script...",
    itemType: "UTxOs",
  });

  // 1. Fetch active UTxOs at the validator script credential
  const utxos: UTxO[] = await lucid.utxosAt(valCred);

  // 2. Filter for UTxOs containing the DEX order tracking NFT
  const orderUtxos = utxos.filter((utxo) =>
    Object.keys(utxo.assets).some(
      (unit) =>
        unit.startsWith(constants.mintPolicyId) &&
        unit.length === constants.mintPolicyId.length + 64
    )
  );

  const total = orderUtxos.length;
  const activeKeys = new Set(orderUtxos.map((u) => `${u.txHash}#${u.outputIndex}`));

  // 3. Load cached orders from IndexedDB
  const cachedMap = await getCachedOrders(network);

  const hits: ParsedOnChainOrder[] = [];
  const misses: UTxO[] = [];

  for (const utxo of orderUtxos) {
    const key = `${utxo.txHash}#${utxo.outputIndex}`;
    const cached = cachedMap.get(key);
    if (cached) {
      hits.push(cached);
    } else {
      misses.push(utxo);
    }
  }

  // 4. Prune spent orders in the background (orders no longer active on-chain)
  pruneCachedOrders(network, activeKeys).catch((err) =>
    console.warn("Background order prune error:", err)
  );

  // If all orders were cached hits, return immediately!
  if (misses.length === 0) {
    onProgress?.({
      current: total,
      total,
      stage: `Loaded ${total} active orders from local cache.`,
      itemType: "Orders",
    });
    return hits;
  }

  onProgress?.({
    current: hits.length,
    total,
    stage: `Cached: ${hits.length}, Fetching new: ${misses.length}...`,
    itemType: "Orders",
  });

  const newlyParsed: ParsedOnChainOrder[] = [];

  // 5. Parse only the misses
  await runWithConcurrency(
    misses,
    8,
    async (utxo) => {
      const nftUnit = Object.keys(utxo.assets).find(
        (unit) =>
          unit.startsWith(constants.mintPolicyId) &&
          unit.length === constants.mintPolicyId.length + 64
      );
      if (!nftUnit) return;

      try {
        const datum: PartialOrderDatum = await myDatumOf(lucid, utxo);
        const offeredUnit = assetClassDToUnit(datum.podOfferedAsset);
        const askedUnit = assetClassDToUnit(datum.podAskedAsset);

        const order: ParsedOnChainOrder = {
          utxoRef: {
            txHash: utxo.txHash,
            outputIndex: utxo.outputIndex,
          },
          ownerAddress: toAddress(datum.podOwnerAddr, lucid),
          ownerKey: datum.podOwnerKey,
          offeredAsset: offeredUnit,
          offeredAmount: datum.podOfferedAmount,
          offeredOriginalAmount: datum.podOfferedOriginalAmount,
          askedAsset: askedUnit,
          price: {
            numerator: datum.podPrice.numerator,
            denominator: datum.podPrice.denominator,
          },
          nftUnit,
          depositLovelace: utxo.assets.lovelace,
          partialFills: datum.podPartialFills,
          start: datum.podStart,
          end: datum.podEnd,
        };

        newlyParsed.push(order);
      } catch {
        // Skip unreadable or non-order datum
      }
    },
    (current) => {
      onProgress?.({
        current: hits.length + current,
        total,
        stage: `Fetching new orders (${hits.length + current}/${total})`,
        itemType: "Orders",
      });
    },
    () => !!abortSignal?.aborted
  );

  // 6. Save newly parsed orders to IndexedDB cache
  if (newlyParsed.length > 0) {
    saveCachedOrders(network, newlyParsed).catch((err) =>
      console.warn("Failed to save orders to cache:", err)
    );
  }

  return [...hits, ...newlyParsed];
}

/**
 * Maps a Smart Liquidity Vault leg (straight or reverse) to a DexOrder so it can live seamlessly in the order book.
 */
export function mapVaultLegToDexOrder(
  vault: LiquidityVault,
  direction: "straight" | "reverse",
  pair: TradingPair,
  referenceOraclePrice?: number,
  userPkhList: string[] = []
): DexOrder | null {
  const isAtoB =
    vault.tokenA.unit === pair.baseToken.unit &&
    vault.tokenB.unit === pair.quoteToken.unit;
  const isBtoA =
    vault.tokenA.unit === pair.quoteToken.unit &&
    vault.tokenB.unit === pair.baseToken.unit;

  if (!isAtoB && !isBtoA) {
    return null;
  }

  const isUserOrder =
    vault.isUserVault ||
    (userPkhList.length > 0 &&
      userPkhList.some(
        (pkh) => pkh.toLowerCase() === vault.ownerKey.toLowerCase()
      ));

  let orderType: "bid" | "ask";
  let offeredAsset: string;
  let askedAsset: string;
  let offeredAmount: bigint;
  let effectivePrice = 0;
  const isDynamicOracle =
    vault.pricingType === "delta_oracle" || vault.pricingType === "oracle_range";

  if (isDynamicOracle) {
    const vKey = vault.oracleDelta?.oracleKey?.toLowerCase();
    const SUPPORTED_ORACLES = [
      "24207cde7ca2dc27431ff87b5324ab5b0d8c113f608f5143ff50a6bae60373c0",
      "b953f42e6d44d217ed8ae94a20f3b448ca45757031dfdb2b879ae389cac68e29",
    ];
    if (!vKey || !SUPPORTED_ORACLES.includes(vKey)) {
      return null;
    }
  }

  if (isAtoB) {
    // Vault Token A = Base (e.g. GENS), Vault Token B = Quote (e.g. ADA)
    if (direction === "straight") {
      // Straight: offers Token A (Base) to receive Token B (Quote) => ASK
      if (vault.amountA <= 0n) return null;
      orderType = "ask";
      offeredAsset = pair.baseToken.unit;
      askedAsset = pair.quoteToken.unit;
      offeredAmount = vault.amountA;

      if (vault.pricingType === "fixed" && vault.fixedPrice) {
        effectivePrice = vault.fixedPrice.priceAtoB;
      } else if (isDynamicOracle && referenceOraclePrice && referenceOraclePrice > 0) {
        const spread = (vault.oracleDelta?.straightSpreadPercent ?? 0) / 100;
        const offset = vault.oracleDelta?.straightOffset ?? 0;
        effectivePrice = referenceOraclePrice * (1 + spread) + offset;
      }
    } else {
      // Reverse: offers Token B (Quote) to receive Token A (Base) => BID
      const hasReverse =
        vault.pricingType === "fixed"
          ? !!vault.fixedPrice?.hasReverse
          : !!vault.oracleDelta?.hasReverse;
      if (!hasReverse || vault.amountB <= 0n) return null;

      orderType = "bid";
      offeredAsset = pair.quoteToken.unit;
      askedAsset = pair.baseToken.unit;
      offeredAmount = vault.amountB;

      if (vault.pricingType === "fixed" && vault.fixedPrice) {
        effectivePrice =
          vault.fixedPrice.reversePriceAtoB ??
          (vault.fixedPrice.reversePriceBtoA ? 1 / vault.fixedPrice.reversePriceBtoA : 0);
      } else if (isDynamicOracle && referenceOraclePrice && referenceOraclePrice > 0) {
        const spread = (vault.oracleDelta?.reverseSpreadPercent ?? 0) / 100;
        const offset = vault.oracleDelta?.reverseOffset ?? 0;
        effectivePrice = referenceOraclePrice * (1 - spread) - offset;
      }
    }
  } else {
    // Vault Token A = Quote (e.g. ADA), Vault Token B = Base (e.g. GENS)
    if (direction === "straight") {
      // Straight: offers Token A (Quote) to receive Token B (Base) => BID
      if (vault.amountA <= 0n) return null;
      orderType = "bid";
      offeredAsset = pair.quoteToken.unit;
      askedAsset = pair.baseToken.unit;
      offeredAmount = vault.amountA;

      if (vault.pricingType === "fixed" && vault.fixedPrice) {
        effectivePrice =
          vault.fixedPrice.priceBtoA ??
          (vault.fixedPrice.priceAtoB ? 1 / vault.fixedPrice.priceAtoB : 0);
      } else if (isDynamicOracle && referenceOraclePrice && referenceOraclePrice > 0) {
        const spread = (vault.oracleDelta?.straightSpreadPercent ?? 0) / 100;
        const offset = vault.oracleDelta?.straightOffset ?? 0;
        effectivePrice = referenceOraclePrice * (1 - spread) - offset;
      }
    } else {
      // Reverse: offers Token B (Base) to receive Token A (Quote) => ASK
      const hasReverse =
        vault.pricingType === "fixed"
          ? !!vault.fixedPrice?.hasReverse
          : !!vault.oracleDelta?.hasReverse;
      if (!hasReverse || vault.amountB <= 0n) return null;

      orderType = "ask";
      offeredAsset = pair.baseToken.unit;
      askedAsset = pair.quoteToken.unit;
      offeredAmount = vault.amountB;

      if (vault.pricingType === "fixed" && vault.fixedPrice) {
        effectivePrice =
          vault.fixedPrice.reversePriceBtoA ??
          (vault.fixedPrice.reversePriceAtoB ? 1 / vault.fixedPrice.reversePriceAtoB : 0);
      } else if (isDynamicOracle && referenceOraclePrice && referenceOraclePrice > 0) {
        const spread = (vault.oracleDelta?.reverseSpreadPercent ?? 0) / 100;
        const offset = vault.oracleDelta?.reverseOffset ?? 0;
        effectivePrice = referenceOraclePrice * (1 + spread) + offset;
      }
    }
  }

  if (effectivePrice <= 0 || !isFinite(effectivePrice)) {
    return null;
  }

  let rationalPrice: RationalPrice;
  try {
    const quoteRatio = orderType === "ask" ? effectivePrice : 1 / effectivePrice;
    const fromDecimals = orderType === "ask" ? pair.baseToken.decimals : pair.quoteToken.decimals;
    const toDecimals = orderType === "ask" ? pair.quoteToken.decimals : pair.baseToken.decimals;
    const decimalFactor = Math.pow(10, toDecimals - fromDecimals);
    const rawRatio = quoteRatio * decimalFactor;
    const r = toExactRational(rawRatio > 0 ? rawRatio : 1);
    rationalPrice = { numerator: r.numerator, denominator: r.denominator };
  } catch {
    rationalPrice = { numerator: 1n, denominator: 1n };
  }

  return {
    utxoRef: vault.utxoRef,
    ownerAddress: vault.ownerAddress || "",
    ownerKey: vault.ownerKey,
    offeredAsset,
    offeredAmount,
    offeredOriginalAmount: offeredAmount,
    askedAsset,
    price: rationalPrice,
    effectivePrice,
    orderType,
    nftUnit: vault.nftUnit,
    depositLovelace: vault.containedFeeLovelace || 2_000_000n,
    partialFills: 0n,
    isExpired: false,
    isUserOrder,
    isVault: true,
    vaultData: vault,
    vaultDirection: direction,
    isDynamicOracle,
    oracleKey: vault.oracleDelta?.oracleKey,
  };
}

export async function fetchAllOrdersForPair(
  lucid: LucidEvolution,
  network: NetworkType,
  pair: TradingPair,
  userPkh?: string | string[],
  onProgress?: (progress: FetchProgress) => void,
  abortSignal?: { aborted: boolean },
  referenceOraclePrice?: number
): Promise<OrderBook> {
  const pkhList = Array.isArray(userPkh)
    ? userPkh
    : userPkh
    ? [userPkh]
    : [];

  const constants = DEX_CONSTANTS[network];

  // Fetch standard limit orders AND Smart Liquidity Vaults concurrently
  const [allOrders, allVaults] = await Promise.all([
    fetchAllActiveParsedOrders(
      lucid,
      network,
      onProgress,
      abortSignal
    ),
    constants.slvScriptHash
      ? fetchAllLiquidityVaults(
          lucid,
          network,
          [],
          [],
          pkhList,
          undefined
        ).catch((err) => {
          console.warn("Failed to fetch liquidity vaults for order book:", err);
          return [] as LiquidityVault[];
        })
      : Promise.resolve([] as LiquidityVault[]),
  ]);

  // Resolve reference oracle price if not supplied (enables dynamic DeltaOracle vaults in order book)
  let activeOraclePrice = referenceOraclePrice;
  if (!activeOraclePrice || activeOraclePrice <= 0) {
    try {
      // 1. Try dual-source oracle daemon (supports testnet mapping & circuit-breaker)
      const oracleRes = await fetch(
        `https://2.28.204.8.sslip.io/api/v1/oracle/price?network=${network}&unit=${pair.baseToken.unit}&symbol=${pair.baseToken.symbol}&maxDivergenceRatio=0.15`
      );
      if (oracleRes.ok) {
        const oData = await oracleRes.json();
        if (oData.approved && oData.meanPrice > 0) {
          activeOraclePrice = oData.meanPrice;
        }
      }
    } catch {
      // ignore
    }
  }

  if (!activeOraclePrice || activeOraclePrice <= 0) {
    try {
      // 2. Direct Minswap query (Mainnet)
      const minswap = await fetchMinswapPrice(pair, network);
      if (minswap?.available && minswap.priceBaseInQuote > 0) {
        activeOraclePrice = minswap.priceBaseInQuote;
      }
    } catch {
      // ignore
    }
  }

  const bids: DexOrder[] = [];
  const asks: DexOrder[] = [];
  const now = Date.now();

  for (const rawOrder of allOrders) {
    const isAsk =
      rawOrder.offeredAsset === pair.baseToken.unit &&
      rawOrder.askedAsset === pair.quoteToken.unit;

    const isBid =
      rawOrder.offeredAsset === pair.quoteToken.unit &&
      rawOrder.askedAsset === pair.baseToken.unit;

    if (!isAsk && !isBid) continue;

    // Skip orders that have expired or are not yet active
    if (rawOrder.end && Number(rawOrder.end) <= now) {
      continue;
    }
    if (rawOrder.start && Number(rawOrder.start) > now) {
      continue;
    }

    const num = Number(rawOrder.price.numerator);
    const den = Number(rawOrder.price.denominator);
    if (den === 0 || num === 0) continue;

    let effectivePrice = 0;
    if (isAsk) {
      const rawRatio = num / den;
      const decimalAdjustment = Math.pow(
        10,
        pair.baseToken.decimals - pair.quoteToken.decimals
      );
      effectivePrice = rawRatio * decimalAdjustment;
    } else {
      const rawRatio = den / num;
      const decimalAdjustment = Math.pow(
        10,
        pair.baseToken.decimals - pair.quoteToken.decimals
      );
      effectivePrice = rawRatio * decimalAdjustment;
    }

    const order: DexOrder = {
      utxoRef: rawOrder.utxoRef,
      ownerAddress: rawOrder.ownerAddress,
      ownerKey: rawOrder.ownerKey,
      offeredAsset: rawOrder.offeredAsset,
      offeredAmount: rawOrder.offeredAmount,
      offeredOriginalAmount: rawOrder.offeredOriginalAmount,
      askedAsset: rawOrder.askedAsset,
      price: rawOrder.price,
      effectivePrice,
      orderType: isAsk ? "ask" : "bid",
      nftUnit: rawOrder.nftUnit,
      depositLovelace: rawOrder.depositLovelace,
      partialFills: rawOrder.partialFills,
      start: rawOrder.start,
      end: rawOrder.end,
      isExpired: false,
      isUserOrder: pkhList.length > 0 ? pkhList.includes(rawOrder.ownerKey) : false,
    };

    if (isAsk) {
      asks.push(order);
    } else {
      bids.push(order);
    }
  }

  // 2. Map Smart Liquidity Vaults into order book (Straight and Reverse legs)
  for (const vault of allVaults) {
    const straightOrder = mapVaultLegToDexOrder(
      vault,
      "straight",
      pair,
      activeOraclePrice,
      pkhList
    );
    if (straightOrder) {
      if (straightOrder.orderType === "ask") {
        asks.push(straightOrder);
      } else {
        bids.push(straightOrder);
      }
    }

    const reverseOrder = mapVaultLegToDexOrder(
      vault,
      "reverse",
      pair,
      activeOraclePrice,
      pkhList
    );
    if (reverseOrder) {
      if (reverseOrder.orderType === "ask") {
        asks.push(reverseOrder);
      } else {
        bids.push(reverseOrder);
      }
    }
  }

  // Sort asks ascending by price (cheapest sell first)
  asks.sort((a, b) => a.effectivePrice - b.effectivePrice);

  // Sort bids descending by price (highest buy first)
  bids.sort((a, b) => b.effectivePrice - a.effectivePrice);

  const highestBid = bids.length > 0 ? bids[0].effectivePrice : null;
  const lowestAsk = asks.length > 0 ? asks[0].effectivePrice : null;

  let spread: number | null = null;
  let spreadPercentage: number | null = null;

  if (highestBid !== null && lowestAsk !== null) {
    spread = lowestAsk - highestBid;
    if (lowestAsk > 0) {
      spreadPercentage = (spread / lowestAsk) * 100;
    }
  }

  return {
    bids,
    asks,
    highestBid,
    lowestAsk,
    spread,
    spreadPercentage,
  };
}

export async function fetchUserOrders(
  lucid: LucidEvolution,
  network: NetworkType,
  userPkh: string | string[],
  onProgress?: (progress: FetchProgress) => void,
  abortSignal?: { aborted: boolean },
  pair?: TradingPair,
  referenceOraclePrice?: number
): Promise<DexOrder[]> {
  const pkhList = Array.isArray(userPkh)
    ? userPkh
    : userPkh
    ? [userPkh]
    : [];

  if (pkhList.length === 0) return [];

  const constants = DEX_CONSTANTS[network];

  const [allOrders, allVaults] = await Promise.all([
    fetchAllActiveParsedOrders(
      lucid,
      network,
      onProgress,
      abortSignal
    ),
    constants.slvScriptHash
      ? fetchAllLiquidityVaults(
          lucid,
          network,
          [],
          [],
          pkhList,
          undefined
        ).catch(() => [] as LiquidityVault[])
      : Promise.resolve([] as LiquidityVault[]),
  ]);

  const userOrders: DexOrder[] = [];
  const now = Date.now();

  for (const rawOrder of allOrders) {
    if (!pkhList.includes(rawOrder.ownerKey)) continue;

    const num = Number(rawOrder.price.numerator);
    const den = Number(rawOrder.price.denominator);
    const effectivePrice = den > 0 ? num / den : 0;
    const isExpired = !!rawOrder.end && Number(rawOrder.end) <= now;

    userOrders.push({
      utxoRef: rawOrder.utxoRef,
      ownerAddress: rawOrder.ownerAddress,
      ownerKey: rawOrder.ownerKey,
      offeredAsset: rawOrder.offeredAsset,
      offeredAmount: rawOrder.offeredAmount,
      offeredOriginalAmount: rawOrder.offeredOriginalAmount,
      askedAsset: rawOrder.askedAsset,
      price: rawOrder.price,
      effectivePrice,
      orderType: rawOrder.offeredAsset === "lovelace" ? "bid" : "ask",
      nftUnit: rawOrder.nftUnit,
      depositLovelace: rawOrder.depositLovelace,
      partialFills: rawOrder.partialFills,
      start: rawOrder.start,
      end: rawOrder.end,
      isExpired,
      isUserOrder: true,
    });
  }

  // Include user's own liquidity vaults if matching pair
  if (pair) {
    for (const vault of allVaults) {
      if (!vault.isUserVault && !pkhList.includes(vault.ownerKey)) continue;

      const straight = mapVaultLegToDexOrder(
        vault,
        "straight",
        pair,
        referenceOraclePrice,
        pkhList
      );
      if (straight) userOrders.push(straight);

      const reverse = mapVaultLegToDexOrder(
        vault,
        "reverse",
        pair,
        referenceOraclePrice,
        pkhList
      );
      if (reverse) userOrders.push(reverse);
    }
  }

  return userOrders;
}
