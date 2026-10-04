import { LucidEvolution, UTxO } from "@lucid-evolution/lucid";
import { DexOrder, NetworkType, OrderBook, TradingPair, FetchProgress } from "../types";
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

export async function fetchAllOrdersForPair(
  lucid: LucidEvolution,
  network: NetworkType,
  pair: TradingPair,
  userPkh?: string | string[],
  onProgress?: (progress: FetchProgress) => void,
  abortSignal?: { aborted: boolean }
): Promise<OrderBook> {
  const pkhList = Array.isArray(userPkh)
    ? userPkh
    : userPkh
    ? [userPkh]
    : [];

  const allOrders = await fetchAllActiveParsedOrders(
    lucid,
    network,
    onProgress,
    abortSignal
  );

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
  abortSignal?: { aborted: boolean }
): Promise<DexOrder[]> {
  const pkhList = Array.isArray(userPkh)
    ? userPkh
    : userPkh
    ? [userPkh]
    : [];

  if (pkhList.length === 0) return [];

  const allOrders = await fetchAllActiveParsedOrders(
    lucid,
    network,
    onProgress,
    abortSignal
  );

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

  return userOrders;
}
