import { LucidEvolution, OutRef, UTxO } from "@lucid-evolution/lucid";
import { DexOrder, TradingPair } from "../types";
import { createOrder, cancelOrders } from "../contracts/api";
import { RationalD } from "../contracts/contract.types";

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
  orderType: "buy" | "sell";
  amount: number; // In base token units (e.g. 50 GENS)
  price: number; // In ADA per base token (e.g. 0.25 ADA / GENS)
}

export async function placeLimitOrder(
  lucid: LucidEvolution,
  params: PlaceOrderParams
): Promise<{ txHash: string }> {
  const { pair, orderType, amount, price } = params;

  if (amount <= 0) {
    throw new Error("Amount must be greater than 0.");
  }
  if (price <= 0) {
    throw new Error("Price must be greater than 0.");
  }

  const walletUtxos: UTxO[] = await lucid.wallet().getUtxos();
  if (walletUtxos.length === 0) {
    throw new Error("No UTxOs found in wallet to build transaction.");
  }

  // Find a suitable UTxO to seed the order NFT
  const anUTxO = walletUtxos[0];
  const ownerAddress = await lucid.wallet().address();

  let offerAmt: bigint;
  let offerAC: string;
  let priceAC: string;
  let rationalPrice: RationalD;

  if (orderType === "sell") {
    // User offers base token (e.g. GENS) and asks for quote token (e.g. ADA)
    offerAC = pair.baseToken.unit;
    priceAC = pair.quoteToken.unit;
    offerAmt = BigInt(Math.floor(amount * Math.pow(10, pair.baseToken.decimals)));

    // price = asked / offered = (price * 10^quoteDecimals) / (10^baseDecimals)
    const scale = 1_000_000n;
    const num = BigInt(Math.round(price * Number(scale))) * BigInt(Math.pow(10, pair.quoteToken.decimals));
    const den = scale * BigInt(Math.pow(10, pair.baseToken.decimals));
    rationalPrice = toSimplifiedRational(num, den);
  } else {
    // User offers quote token (e.g. ADA) and asks for base token (e.g. GENS)
    offerAC = pair.quoteToken.unit;
    priceAC = pair.baseToken.unit;
    const totalQuote = amount * price;
    offerAmt = BigInt(Math.floor(totalQuote * Math.pow(10, pair.quoteToken.decimals)));

    // In a buy order datum: asked is base, offered is quote
    // price = asked / offered = (amount * 10^baseDecimals) / (totalQuote * 10^quoteDecimals) = 1 / price
    const scale = 1_000_000n;
    const num = scale * BigInt(Math.pow(10, pair.baseToken.decimals));
    const den = BigInt(Math.round(price * Number(scale))) * BigInt(Math.pow(10, pair.quoteToken.decimals));
    rationalPrice = toSimplifiedRational(num, den);
  }

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
