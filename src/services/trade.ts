import { LucidEvolution, OutRef, UTxO } from "@lucid-evolution/lucid";
import { DexOrder, TradingPair } from "../types";
import { createOrder, cancelOrders, fillOrder, myDatumOf } from "../contracts/api";
import { RationalD } from "../contracts/contract.types";
import { parseTokenUnits } from "../contracts/utils";

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

export function toSimplifiedRational(num: bigint, den: bigint): RationalD {
  const g = gcd(num, den);
  return {
    numerator: num / g,
    denominator: den / g,
  };
}

export interface PlaceOrderParams {
  pair: TradingPair;
  // Symmetric token direction:
  offerAsset?: "base" | "quote"; // "base" = depositing baseToken, asking quoteToken; "quote" = depositing quoteToken, asking baseToken
  offerAmount?: number; // In units of the offered token (e.g. 100 GENS)
  askAmount?: number; // In units of the asked token (e.g. 25 ADA)
  // Legacy parameters (for backwards compatibility)
  orderType?: "buy" | "sell";
  amount?: number;
  price?: number;
}

export async function placeLimitOrder(
  lucid: LucidEvolution,
  params: PlaceOrderParams
): Promise<{ txHash: string }> {
  const { pair } = params;

  let offerAsset: "base" | "quote";
  let offerAmount: number;
  let askAmount: number;

  if (params.offerAsset && params.offerAmount !== undefined && params.askAmount !== undefined) {
    offerAsset = params.offerAsset;
    offerAmount = params.offerAmount;
    askAmount = params.askAmount;
  } else if (params.orderType && params.amount !== undefined && params.price !== undefined) {
    // Legacy conversion:
    // "sell" = offer base, ask quote (askAmount = amount * price)
    // "buy" = offer quote, ask base (offerAmount = amount * price, askAmount = amount)
    if (params.orderType === "sell") {
      offerAsset = "base";
      offerAmount = params.amount;
      askAmount = params.amount * params.price;
    } else {
      offerAsset = "quote";
      offerAmount = params.amount * params.price;
      askAmount = params.amount;
    }
  } else {
    throw new Error("Invalid order parameters: please provide offer and ask amounts.");
  }

  if (offerAmount <= 0) {
    throw new Error("Offer amount must be greater than 0.");
  }
  if (askAmount <= 0) {
    throw new Error("Ask amount must be greater than 0.");
  }

  const walletUtxos: UTxO[] = await lucid.wallet().getUtxos();
  if (walletUtxos.length === 0) {
    throw new Error("No UTxOs found in wallet to build transaction.");
  }

  // Find a suitable UTxO to seed the order NFT
  const anUTxO = walletUtxos[0];
  const ownerAddress = await lucid.wallet().address();

  let offerAmt: bigint;
  let askAmt: bigint;
  let offerAC: string;
  let priceAC: string;

  if (offerAsset === "base") {
    // User offers base token (e.g. GENS) and asks for quote token (e.g. ADA)
    offerAC = pair.baseToken.unit;
    priceAC = pair.quoteToken.unit;
    offerAmt = parseTokenUnits(offerAmount, pair.baseToken.decimals);
    askAmt = parseTokenUnits(askAmount, pair.quoteToken.decimals);
  } else {
    // User offers quote token (e.g. ADA) and asks for base token (e.g. GENS)
    offerAC = pair.quoteToken.unit;
    priceAC = pair.baseToken.unit;
    offerAmt = parseTokenUnits(offerAmount, pair.quoteToken.decimals);
    askAmt = parseTokenUnits(askAmount, pair.baseToken.decimals);
  }

  // Rational price in datum is asked / offered
  const rationalPrice = toSimplifiedRational(askAmt, offerAmt);

  const [, txBuilder] = await createOrder(
    lucid,
    lucid.newTx(),
    anUTxO,
    ownerAddress,
    offerAmt,
    offerAC,
    priceAC,
    rationalPrice,
    true
  );

  const completedTx = await txBuilder.complete();
  const signedTx = await completedTx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  return { txHash };
}

export async function cancelLimitOrder(
  lucid: LucidEvolution,
  order: DexOrder
): Promise<{ txHash: string }> {
  const orderRef: OutRef = {
    txHash: order.utxoRef.txHash,
    outputIndex: order.utxoRef.outputIndex,
  };

  const txBuilder = await cancelOrders(lucid, lucid.newTx(), [orderRef]);
  const completedTx = await txBuilder.complete();
  const signedTx = await completedTx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  return { txHash };
}

export interface FillOrderParams {
  order: DexOrder;
  fillAmount?: bigint; // in offered token raw units
}

export function calculateFillCost(
  order: DexOrder,
  fillAmount?: bigint
): {
  payAssetUnit: string;
  payAmount: bigint;
  receiveAssetUnit: string;
  receiveAmount: bigint;
  takerFeeLovelace: bigint;
  isComplete: boolean;
} {
  const actualFill =
    !fillAmount || fillAmount >= order.offeredAmount
      ? order.offeredAmount
      : fillAmount;

  const isComplete = actualFill >= order.offeredAmount;

  // price = (amt * num + den - 1) / den
  const payAmt =
    (actualFill * order.price.numerator + order.price.denominator - 1n) /
    order.price.denominator;

  return {
    payAssetUnit: order.askedAsset,
    payAmount: payAmt,
    receiveAssetUnit: order.offeredAsset,
    receiveAmount: actualFill,
    takerFeeLovelace: 1_000_000n, // 1 ADA flat taker fee
    isComplete,
  };
}

export async function fillDexOrder(
  lucid: LucidEvolution,
  params: FillOrderParams
): Promise<{ txHash: string }> {
  const { order, fillAmount } = params;

  const orderOutRef: OutRef = {
    txHash: order.utxoRef.txHash,
    outputIndex: order.utxoRef.outputIndex,
  };

  const [orderUTxO] = await lucid.utxosByOutRef([orderOutRef]);
  if (!orderUTxO) {
    throw new Error(
      "Order UTxO not found on-chain. It may have already been filled or cancelled."
    );
  }

  const orderDatum = await myDatumOf(lucid, orderUTxO);

  const txBuilder = await fillOrder(
    lucid,
    lucid.newTx(),
    orderUTxO,
    orderDatum,
    fillAmount
  );

  const completedTx = await txBuilder.complete();
  const signedTx = await completedTx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  return { txHash };
}

