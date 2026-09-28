import { LucidEvolution, UTxO } from "@lucid-evolution/lucid";
import { DexOrder, NetworkType, OrderBook, TradingPair } from "../types";
import { DEX_CONSTANTS } from "../config/dex";
import { myDatumOf } from "../contracts/api";
import { assetClassDToUnit, toAddress } from "../contracts/utils";
import { PartialOrderDatum } from "../contracts/contract.types";

export async function fetchAllOrdersForPair(
  lucid: LucidEvolution,
  network: NetworkType,
  pair: TradingPair,
  userPkh?: string | string[]
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

  // Fetch UTxOs at the validator script credential
  const utxos: UTxO[] = await lucid.utxosAt(valCred);

  const bids: DexOrder[] = [];
  const asks: DexOrder[] = [];

  for (const utxo of utxos) {
    // Must contain an order tracking NFT minted by the DEX policy
    const nftUnit = Object.keys(utxo.assets).find(
      (unit) =>
        unit.startsWith(constants.mintPolicyId) &&
        unit.length === constants.mintPolicyId.length + 64
    );

    if (!nftUnit) continue;

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

      if (!isAsk && !isBid) continue;

      const num = Number(datum.podPrice.numerator);
      const den = Number(datum.podPrice.denominator);
      if (den === 0 || num === 0) continue;

      let effectivePrice = 0;
      if (isAsk) {
        // Price = Quote per Base = (asked / offered) * 10^(baseDecimals - quoteDecimals)
        const rawRatio = num / den;
        const decimalAdjustment = Math.pow(
          10,
          pair.baseToken.decimals - pair.quoteToken.decimals
        );
        effectivePrice = rawRatio * decimalAdjustment;
      } else {
        // In the datum of a bid: offered is quote (ADA), asked is base (GENS)
        // datum.podPrice is asked/offered = base/quote
        // Therefore, ADA per base = 1 / (base / quote) = den / num
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
        isUserOrder: pkhList.length > 0 ? pkhList.includes(datum.podOwnerKey) : false,
      };

      if (isAsk) {
        asks.push(order);
      } else {
        bids.push(order);
      }
    } catch {
      // Not a valid or readable order datum, skip gracefully
      continue;
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
  userPkh: string | string[]
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
  const userOrders: DexOrder[] = [];

  for (const utxo of utxos) {
    const nftUnit = Object.keys(utxo.assets).find(
      (unit) =>
        unit.startsWith(constants.mintPolicyId) &&
        unit.length === constants.mintPolicyId.length + 64
    );
    if (!nftUnit) continue;

    try {
      const datum: PartialOrderDatum = await myDatumOf(lucid, utxo);
      if (!pkhList.includes(datum.podOwnerKey)) continue;

      const offeredUnit = assetClassDToUnit(datum.podOfferedAsset);
      const askedUnit = assetClassDToUnit(datum.podAskedAsset);

      const num = Number(datum.podPrice.numerator);
      const den = Number(datum.podPrice.denominator);
      const effectivePrice = den > 0 ? num / den : 0;

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
        isUserOrder: true,
      });
    } catch {
      continue;
    }
  }

  return userOrders;
}
