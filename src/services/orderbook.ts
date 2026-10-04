import { LucidEvolution, UTxO } from "@lucid-evolution/lucid";
import { DexOrder, NetworkType, OrderBook, TradingPair, FetchProgress } from "../types";
import { DEX_CONSTANTS } from "../config/dex";
import { myDatumOf } from "../contracts/api";
import { assetClassDToUnit, toAddress } from "../contracts/utils";
import { PartialOrderDatum } from "../contracts/contract.types";
import { runWithConcurrency } from "./staking";

export async function fetchAllOrdersForPair(
  lucid: LucidEvolution,
  network: NetworkType,
  pair: TradingPair,
  userPkh?: string | string[],
  onProgress?: (progress: FetchProgress) => void,
  abortSignal?: { aborted: boolean }
): Promise<OrderBook> {
  const constants = DEX_CONSTANTS[network];
  const valCred = {
    type: "Script" as const,
    hash: constants.valCredHash,
  };

  const pkhList = Array.isArray(userPkh)
    ? userPkh
    : userPkh
    ? [userPkh]
    : [];

  onProgress?.({
    current: 0,
    total: 1,
    stage: "Fetching UTxOs at DEX order script...",
    itemType: "UTxOs",
  });

  // Fetch UTxOs at the validator script credential
  const utxos: UTxO[] = await lucid.utxosAt(valCred);

  // Filter for UTxOs containing the DEX order tracking NFT
  const orderUtxos = utxos.filter((utxo) =>
    Object.keys(utxo.assets).some(
      (unit) =>
        unit.startsWith(constants.mintPolicyId) &&
        unit.length === constants.mintPolicyId.length + 64
    )
  );

  const total = orderUtxos.length;
  onProgress?.({
    current: 0,
    total,
    stage: `Found ${total} DEX orders. Parsing datums...`,
    itemType: "Orders",
  });

  const bids: DexOrder[] = [];
  const asks: DexOrder[] = [];

  await runWithConcurrency(
    orderUtxos,
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

        const isAsk =
          offeredUnit === pair.baseToken.unit &&
          askedUnit === pair.quoteToken.unit;

        const isBid =
          offeredUnit === pair.quoteToken.unit &&
          askedUnit === pair.baseToken.unit;

        if (!isAsk && !isBid) return;

        // Skip orders that have expired or are not yet active
        const now = Date.now();
        if (datum.podEnd && Number(datum.podEnd) <= now) {
          return;
        }
        if (datum.podStart && Number(datum.podStart) > now) {
          return;
        }

        const num = Number(datum.podPrice.numerator);
        const den = Number(datum.podPrice.denominator);
        if (den === 0 || num === 0) return;

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
          effectivePrice,
          orderType: isAsk ? "ask" : "bid",
          nftUnit,
          depositLovelace: utxo.assets.lovelace,
          partialFills: datum.podPartialFills,
          start: datum.podStart,
          end: datum.podEnd,
          isExpired: false,
          isUserOrder: pkhList.length > 0 ? pkhList.includes(datum.podOwnerKey) : false,
        };

        if (isAsk) {
          asks.push(order);
        } else {
          bids.push(order);
        }
      } catch {
        // Skip unreadable or non-order datum
      }
    },
    (current, total) => {
      onProgress?.({
        current,
        total,
        stage: `Fetching order datums (${current}/${total})`,
        itemType: "Orders",
      });
    },
    () => !!abortSignal?.aborted
  );

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
  const constants = DEX_CONSTANTS[network];
  const valCred = {
    type: "Script" as const,
    hash: constants.valCredHash,
  };

  const pkhList = Array.isArray(userPkh)
    ? userPkh
    : userPkh
    ? [userPkh]
    : [];

  const utxos: UTxO[] = await lucid.utxosAt(valCred);
  const orderUtxos = utxos.filter((utxo) =>
    Object.keys(utxo.assets).some(
      (unit) =>
        unit.startsWith(constants.mintPolicyId) &&
        unit.length === constants.mintPolicyId.length + 64
    )
  );

  const userOrders: DexOrder[] = [];

  await runWithConcurrency(
    orderUtxos,
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
        if (!pkhList.includes(datum.podOwnerKey)) return;

        const offeredUnit = assetClassDToUnit(datum.podOfferedAsset);
        const askedUnit = assetClassDToUnit(datum.podAskedAsset);

        const num = Number(datum.podPrice.numerator);
        const den = Number(datum.podPrice.denominator);
        const effectivePrice = den > 0 ? num / den : 0;
        const now = Date.now();
        const isExpired = !!datum.podEnd && Number(datum.podEnd) <= now;

        userOrders.push({
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
          effectivePrice,
          orderType: offeredUnit === "lovelace" ? "bid" : "ask",
          nftUnit,
          depositLovelace: utxo.assets.lovelace,
          partialFills: datum.podPartialFills,
          start: datum.podStart,
          end: datum.podEnd,
          isExpired,
          isUserOrder: true,
        });
      } catch {
        // Skip
      }
    },
    (current, total) => {
      onProgress?.({
        current,
        total,
        stage: `Scanning user orders (${current}/${total})`,
        itemType: "Orders",
      });
    },
    () => !!abortSignal?.aborted
  );

  return userOrders;
}
