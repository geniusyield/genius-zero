import {
  Address,
  Assets,
  Credential,
  Data,
  LucidEvolution,
  OutRef,
  TxBuilder,
  UTxO,
  Unit,
  UnixTime,
  credentialToAddress,
  paymentCredentialOf,
} from "@lucid-evolution/lucid";
import {
  AssetClassD,
  OutputReferenceD,
  PONftPolicyRedeemer,
  PartialOrderConfigDatum,
  PartialOrderContainedFee,
  PartialOrderDatum,
  PartialOrderFeeOutput,
  PartialOrderRedeemer,
  RationalD,
  ValueD,
} from "./contract.types";
import {
  assetClassDFromUnit,
  assetClassDToUnit,
  containedFeeToAssetsM,
  expectedPaymentWithDeposit,
  expectedTokenName,
  fromAddress,
  fromAssets,
  isEqualContainedFee,
  mappendAssets,
  partialOrderPrice,
  resolveAC,
  toAddress,
  zeroContainedFee,
} from "./utils";
import { PartialOrderConstants, resolvePOConstants } from "./constants";

export interface Fees {
  percentTokenFees: Assets;
  flatLovelaceFees: bigint;
}

export const fetchPartialOrderConfig = async (
  lucid: LucidEvolution
): Promise<[PartialOrderConfigDatum, UTxO]> => {
  const poConstants = resolvePOConstants(lucid);
  try {
    const utxo = await lucid.utxoByUnit(poConstants.refNft);
    return [Data.from(utxo.datum as string, PartialOrderConfigDatum), utxo];
  } catch (err) {
    if (poConstants.fallbackRefNft) {
      try {
        const utxo = await lucid.utxoByUnit(poConstants.fallbackRefNft);
        return [Data.from(utxo.datum as string, PartialOrderConfigDatum), utxo];
      } catch {
        // continue to address fallback
      }
    }
    // Fallback: search at config address directly
    try {
      const utxos = await lucid.utxosAt(poConstants.configAddr);
      const match = utxos.find(
        (u) =>
          u.datum &&
          (Object.keys(u.assets).includes(poConstants.refNft) ||
            (poConstants.fallbackRefNft &&
              Object.keys(u.assets).includes(poConstants.fallbackRefNft)))
      );
      if (match) {
        return [Data.from(match.datum as string, PartialOrderConfigDatum), match];
      }
    } catch {
      // continue
    }
    throw err;
  }
};

import { getOrFetchDatum } from "../services/cache";

export async function myDatumOf(
  lucid: LucidEvolution,
  utxo: UTxO
): Promise<PartialOrderDatum> {
  let datToResolve = utxo.datum;
  if (!datToResolve) {
    if (!utxo.datumHash) {
      throw new Error("This UTxO does not have a datum or datum hash.");
    }
    datToResolve = await getOrFetchDatum(utxo.datumHash, () =>
      lucid.config().provider.getDatum(utxo.datumHash!)
    );
  }
  return Data.from(datToResolve, PartialOrderDatum);
}

export const createOrder = async (
  lucid: LucidEvolution,
  tx: TxBuilder,
  anUTxO: UTxO,
  owner: Address,
  offerAmt: bigint,
  offerAC: Unit,
  priceAC: Unit,
  price: RationalD,
  inlineDat: boolean = true,
  aStakeCred?: Credential,
  start?: UnixTime,
  end?: UnixTime
): Promise<[Fees, TxBuilder]> => {
  if (offerAmt <= 0n) {
    throw new Error("Offer amount must be positive.");
  }
  if (price.numerator <= 0n || price.denominator <= 0n) {
    throw new Error("Price numerator and denominator must be positive.");
  }
  if (offerAC === priceAC) {
    throw new Error("Offered and asked assets must be different.");
  }
  if (start && end && end < start) {
    throw new Error("End time cannot be earlier than start time.");
  }

  const poConstants = resolvePOConstants(lucid);
  const ownerCred = paymentCredentialOf(owner);
  const outAddr = credentialToAddress(
    lucid.config().network,
    poConstants.valCred,
    aStakeCred
  );
  const anOutRef: OutRef = {
    txHash: anUTxO.txHash,
    outputIndex: anUTxO.outputIndex,
  };
  const nftName = await expectedTokenName(anOutRef);
  const nftUnit = poConstants.mintPolicyId + nftName;

  const resolveTime = (someTime?: UnixTime) => {
    if (someTime) {
      return BigInt(someTime);
    } else {
      return null;
    }
  };

  const [pocDatum, pocUTxO] = await fetchPartialOrderConfig(lucid);
  const makerPercentageFees =
    (offerAmt * pocDatum.pocdMakerFeeRatio.numerator) /
    pocDatum.pocdMakerFeeRatio.denominator;

  const orderDatum: PartialOrderDatum = {
    podOwnerKey: ownerCred.hash,
    podOwnerAddr: fromAddress(owner),
    podOfferedAsset: assetClassDFromUnit(offerAC),
    podOfferedOriginalAmount: offerAmt,
    podOfferedAmount: offerAmt,
    podAskedAsset: assetClassDFromUnit(priceAC),
    podPrice: price,
    podNFT: nftName,
    podStart: resolveTime(start),
    podEnd: resolveTime(end),
    podPartialFills: 0n,
    podMakerLovelaceFlatFee: pocDatum.pocdMakerFeeFlat,
    podTakerLovelaceFlatFee: pocDatum.pocdTakerFee,
    podContainedFee: {
      pocfLovelaces: pocDatum.pocdMakerFeeFlat,
      pocfOfferedTokens: makerPercentageFees,
      pocfAskedTokens: 0n,
    },
    podContainedPayment: 0n,
  };

  const placeOrderAssets: Assets = mappendAssets(
    mappendAssets(
      { [nftUnit]: 1n },
      resolveAC(offerAC, offerAmt + makerPercentageFees)
    ),
    { lovelace: pocDatum.pocdMinDeposit + pocDatum.pocdMakerFeeFlat }
  );

  const datumField = inlineDat ? "inline" : "asHash";

  const txAppended = tx
    .collectFrom([anUTxO])
    .mintAssets(
      { [nftUnit]: 1n },
      Data.to(
        {
          txHash: { hash: anOutRef.txHash },
          outputIndex: BigInt(anOutRef.outputIndex),
        },
        PONftPolicyRedeemer
      )
    )
    .readFrom([pocUTxO, poConstants.mintUTxO])
    .pay.ToContract(
      outAddr,
      {
        kind: datumField,
        value: Data.to(orderDatum, PartialOrderDatum),
      },
      placeOrderAssets
    );

  const orderCreationFees: Fees = {
    percentTokenFees: resolveAC(offerAC, makerPercentageFees),
    flatLovelaceFees: pocDatum.pocdMakerFeeFlat,
  };

  return [orderCreationFees, txAppended];
};

export const cancelOrders = async (
  lucid: LucidEvolution,
  tx: TxBuilder,
  orderRefs: OutRef[]
): Promise<TxBuilder> => {
  const orderUTxOs = await lucid.utxosByOutRef(orderRefs);
  const orderUTxOsWithDatums = await Promise.all(
    orderUTxOs.map(async (utxo): Promise<[UTxO, PartialOrderDatum]> => {
      const datum = await myDatumOf(lucid, utxo);
      return [utxo, datum];
    })
  );

  const poConstants = resolvePOConstants(lucid);
  let txAppend = tx;
  let feeAcc: Assets = {};
  let feeMapAcc: Map<OutputReferenceD, ValueD> = new Map();

  for (const [orderUTxO, orderUTxOsDatum] of orderUTxOsWithDatums) {
    const outputRef: OutputReferenceD = {
      txHash: { hash: orderUTxO.txHash },
      outputIndex: BigInt(orderUTxO.outputIndex),
    };
    const oldContainedFee = orderUTxOsDatum.podContainedFee;
    const makerPercentFeeToRefund =
      (orderUTxOsDatum.podOfferedAmount * oldContainedFee.pocfOfferedTokens) /
      orderUTxOsDatum.podOfferedOriginalAmount;
    const reqContainedFee: PartialOrderContainedFee = {
      pocfLovelaces: oldContainedFee.pocfLovelaces,
      pocfOfferedTokens:
        oldContainedFee.pocfOfferedTokens - makerPercentFeeToRefund,
      pocfAskedTokens: oldContainedFee.pocfAskedTokens,
    };
    const reqContainedFeeValue = containedFeeToAssetsM(
      reqContainedFee,
      orderUTxOsDatum.podOfferedAsset,
      orderUTxOsDatum.podAskedAsset
    );
    const updateFeeCond =
      orderUTxOsDatum.podPartialFills === 0n ||
      isEqualContainedFee(orderUTxOsDatum.podContainedFee, zeroContainedFee);
    feeAcc = updateFeeCond ? feeAcc : mappendAssets(feeAcc, reqContainedFeeValue);
    if (!updateFeeCond) {
      feeMapAcc.set(outputRef, fromAssets(reqContainedFeeValue));
    }

    txAppend = txAppend
      .collectFrom([orderUTxO], Data.to("PartialCancel", PartialOrderRedeemer))
      .pay.ToAddressWithData(
        toAddress(orderUTxOsDatum.podOwnerAddr, lucid),
        { kind: "inline", value: Data.to(outputRef, OutputReferenceD) },
        expectedPaymentWithDeposit(
          poConstants,
          orderUTxO.assets,
          orderUTxOsDatum,
          false
        )
      )
      .addSignerKey(orderUTxOsDatum.podOwnerKey)
      .mintAssets(
        { [poConstants.mintPolicyId + orderUTxOsDatum.podNFT]: -1n },
        Data.to(null, PONftPolicyRedeemer)
      );
  }

  const [pocDatum, pocUTxO] = await fetchPartialOrderConfig(lucid);
  if (Object.keys(feeAcc).length > 0) {
    txAppend = txAppend.pay.ToAddressWithData(
      toAddress(pocDatum.pocdFeeAddr, lucid),
      {
        kind: "asHash",
        value: Data.to(
          {
            pofdMentionedFees: feeMapAcc,
            pofdReservedValue: fromAssets({}),
            pofdSpentUTxORef: null,
          },
          PartialOrderFeeOutput
        ),
      },
      feeAcc
    );
  }

  txAppend = txAppend.readFrom([
    poConstants.mintUTxO,
    poConstants.valUTxO,
    pocUTxO,
  ]);

  return txAppend;
};
