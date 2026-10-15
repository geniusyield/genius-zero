/**
 * Genius Zero — Pure Client-Side Options Library for Cardano
 *
 * Implements the full on-chain Options protocol for Cardano using Lucid Evolution:
 * - Create: Locks deposited assets + 3 ADA minAda, mints tracking Position NFT and fungible Option tokens
 * - Execute: Option holder burns k option tokens, receives k deposit tokens, pays strike price into script
 * - Retrieve: Option writer reclaims remaining deposit + all exercise strike payments after expiration
 * - CancelEarly: Option writer burns all remaining unsold option tokens before cutoff to reclaim 100% deposit
 *
 * Protocol Fee: Zero protocol fees (configured with ADA sentinel).
 */

import {
  type Assets,
  type LucidEvolution,
  type OutRef,
  type SpendingValidator,
  type MintingPolicy,
  type UTxO,
  type TxSignBuilder,
  Constr,
  Data,
  fromHex,
  toHex,
  paymentCredentialOf,
  credentialToAddress,
  getAddressDetails,
  validatorToScriptHash,
  validatorToAddress,
} from "@lucid-evolution/lucid";
import optionsV1 from "./options.v1.json";
import optionsV3 from "./options.v3.json";

// =========================================================================
// TYPES & CONSTANTS
// =========================================================================

export interface OptionAsset {
  policyId: string; // Empty string for ADA
  assetName: string; // Empty string for ADA
}

export interface Rational {
  numerator: bigint;
  denominator: bigint;
}

export type OptionStyle = "European" | "American" | "Custom";

export interface OptionDatum {
  opdRef: OutRef;
  opdToken: OptionAsset;
  opdStart: bigint; // POSIXTime ms
  opdEnd: bigint; // POSIXTime ms
  opdCancelCutoff: bigint; // POSIXTime ms
  opdDeposit: OptionAsset;
  opdPayment: OptionAsset;
  opdPrice: Rational; // Payment tokens per 1 Deposit token
  opdSellerKey: string; // 28-byte hex PubKeyHash
}

export interface CreateOptionParams {
  depositAsset: OptionAsset;
  paymentAsset: OptionAsset;
  depositAmount: bigint;
  strikePrice: Rational; // Payment units per 1 Deposit unit
  style: OptionStyle;
  expirationTimeMs: number;
  startTimeMs?: number; // American default: Date.now() - 5s; European default: expirationTimeMs - 86_400_000
  cancelCutoffMs?: number; // Default: expirationTimeMs (or startTimeMs for European)
  sellerAddress: string;
  seedUtxo?: UTxO; // Optional explicit seed UTxO for opdRef
}

export interface ExecuteOptionParams {
  optionUtxo: UTxO;
  amountToExecute: bigint;
  buyerAddress: string;
}

export interface RetrieveOptionParams {
  optionUtxo: UTxO;
  sellerAddress: string;
  userPkhs?: string[];
}

export interface CancelEarlyOptionParams {
  optionUtxo: UTxO;
  sellerAddress: string;
  amountToCancel?: bigint; // If omitted, defaults to full remaining deposit
  userPkhs?: string[];
}

export const ADA_OPTION_ASSET: OptionAsset = {
  policyId: "",
  assetName: "",
};

export const OPTION_MIN_ADA = 3_000_000n; // 3 ADA required on-chain

export const OPTIONS_VALIDATOR_HASH = optionsV3.validator.hash;
export const OPTIONS_MINT_POLICY_HASH = optionsV3.optionPolicy.hash;
export const OPTIONS_NFT_POLICY_HASH = optionsV3.nftPolicy.hash;

export interface OptionScriptSet {
  version: "v1" | "v2";
  validator: SpendingValidator & { hash: string };
  optionPolicy: MintingPolicy & { hash: string };
  nftPolicy: MintingPolicy & { hash: string };
}

export const OPTIONS_SCRIPTS_V1: OptionScriptSet = {
  version: "v1",
  validator: {
    type: optionsV1.validator.type as "PlutusV3",
    script: optionsV1.validator.cbor,
    hash: optionsV1.validator.hash,
  },
  optionPolicy: {
    type: optionsV1.optionPolicy.type as "PlutusV3",
    script: optionsV1.optionPolicy.cbor,
    hash: optionsV1.optionPolicy.hash,
  },
  nftPolicy: {
    type: optionsV1.nftPolicy.type as "PlutusV2",
    script: optionsV1.nftPolicy.cbor,
    hash: optionsV1.nftPolicy.hash,
  },
};

export const OPTIONS_SCRIPTS_V2: OptionScriptSet = {
  version: "v2",
  validator: {
    type: optionsV3.validator.type as "PlutusV3",
    script: optionsV3.validator.cbor,
    hash: optionsV3.validator.hash,
  },
  optionPolicy: {
    type: optionsV3.optionPolicy.type as "PlutusV3",
    script: optionsV3.optionPolicy.cbor,
    hash: optionsV3.optionPolicy.hash,
  },
  nftPolicy: {
    type: optionsV3.nftPolicy.type as "PlutusV2",
    script: optionsV3.nftPolicy.cbor,
    hash: optionsV3.nftPolicy.hash,
  },
};

// Current active scripts for writing new options
export const OPTIONS_SCRIPTS = OPTIONS_SCRIPTS_V2;

export const ALL_OPTION_SCRIPTS: OptionScriptSet[] = [
  OPTIONS_SCRIPTS_V2,
  OPTIONS_SCRIPTS_V1,
];

export const KNOWN_OPTION_SCRIPTS: Record<string, OptionScriptSet> = {
  [optionsV3.validator.hash.toLowerCase()]: OPTIONS_SCRIPTS_V2,
  [optionsV3.optionPolicy.hash.toLowerCase()]: OPTIONS_SCRIPTS_V2,
  [optionsV1.validator.hash.toLowerCase()]: OPTIONS_SCRIPTS_V1,
  [optionsV1.optionPolicy.hash.toLowerCase()]: OPTIONS_SCRIPTS_V1,
};

export function getOptionScriptsForUtxo(
  optionUtxo: UTxO,
  datum?: OptionDatum
): OptionScriptSet {
  try {
    const cred = paymentCredentialOf(optionUtxo.address);
    if (cred?.hash && KNOWN_OPTION_SCRIPTS[cred.hash.toLowerCase()]) {
      return KNOWN_OPTION_SCRIPTS[cred.hash.toLowerCase()];
    }
  } catch {}

  if (datum?.opdToken?.policyId) {
    const pol = datum.opdToken.policyId.toLowerCase();
    if (KNOWN_OPTION_SCRIPTS[pol]) {
      return KNOWN_OPTION_SCRIPTS[pol];
    }
  }

  return OPTIONS_SCRIPTS_V2;
}

// =========================================================================
// HELPER FUNCTIONS
// =========================================================================

export function isAdaAsset(asset: OptionAsset): boolean {
  return asset.policyId === "" && asset.assetName === "";
}

export function assetToUnit(asset: OptionAsset): string {
  return isAdaAsset(asset) ? "lovelace" : asset.policyId + asset.assetName;
}

/**
 * Computes the 32-byte SHA-256 token name for both Position NFT and Option Tokens.
 * Matching on-chain Plutarch / Haskell:
 *   expectedTokenName (TxOutRef (TxId tid) ix) = sha2_256 (consByteString ix tid)
 */
export async function computeOptionTokenName(ref: OutRef): Promise<string> {
  const indexByte = ref.outputIndex;
  const txHashBytes = fromHex(ref.txHash);
  const data = new Uint8Array(1 + txHashBytes.length);
  data[0] = indexByte;
  data.set(txHashBytes, 1);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return toHex(new Uint8Array(hashBuffer));
}

/**
 * Encodes OptionDatum into a Plutus Constr matching the on-chain specification:
 * Constr 0 [
 *   opdRef: Constr 0 [ Constr 0 [txHashHex], indexInt ],
 *   opdToken: Constr 0 [ policyIdHex, assetNameHex ],
 *   opdStart: int,
 *   opdEnd: int,
 *   opdCancelCutoff: int,
 *   opdDeposit: Constr 0 [ policyIdHex, assetNameHex ],
 *   opdPayment: Constr 0 [ policyIdHex, assetNameHex ],
 *   opdPrice: Constr 0 [ numeratorInt, denominatorInt ],
 *   opdSellerKey: 28-byte hex string
 * ]
 */
export function encodeOptionDatum(datum: OptionDatum): Constr<any> {
  const refConstr = new Constr(0, [
    datum.opdRef.txHash,
    BigInt(datum.opdRef.outputIndex),
  ]);

  const tokenConstr = new Constr(0, [
    datum.opdToken.policyId,
    datum.opdToken.assetName,
  ]);

  const depositConstr = new Constr(0, [
    datum.opdDeposit.policyId,
    datum.opdDeposit.assetName,
  ]);

  const paymentConstr = new Constr(0, [
    datum.opdPayment.policyId,
    datum.opdPayment.assetName,
  ]);

  const priceConstr = new Constr(0, [
    BigInt(datum.opdPrice.numerator),
    BigInt(datum.opdPrice.denominator),
  ]);

  return new Constr(0, [
    refConstr,
    tokenConstr,
    BigInt(datum.opdStart),
    BigInt(datum.opdEnd),
    BigInt(datum.opdCancelCutoff),
    depositConstr,
    paymentConstr,
    priceConstr,
    datum.opdSellerKey,
  ]);
}

/**
 * Decodes an on-chain OptionDatum from CBOR or Plutus Data Constr.
 */
export function decodeOptionDatum(rawDatum: string | Constr<any>): OptionDatum {
  const c =
    typeof rawDatum === "string"
      ? (Data.from(rawDatum) as Constr<any>)
      : rawDatum;

  if (
    !c ||
    c.index !== 0 ||
    !Array.isArray(c.fields) ||
    c.fields.length !== 9
  ) {
    throw new Error(
      `Invalid OptionDatum structure: expected 9 fields at index 0, got ${
        c?.fields?.length
      }`
    );
  }

  const [
    refField,
    tokenField,
    startField,
    endField,
    cutoffField,
    depositField,
    paymentField,
    priceField,
    sellerKeyField,
  ] = c.fields;

  const refConstr = refField as Constr<any>;
  const txHash =
    refConstr.fields[0] instanceof Constr
      ? String((refConstr.fields[0] as Constr<any>).fields[0])
      : String(refConstr.fields[0]);
  const outputIndex = Number(refConstr.fields[1]);

  return {
    opdRef: { txHash, outputIndex },
    opdToken: {
      policyId: String(tokenField.fields[0]),
      assetName: String(tokenField.fields[1]),
    },
    opdStart: BigInt(startField),
    opdEnd: BigInt(endField),
    opdCancelCutoff: BigInt(cutoffField),
    opdDeposit: {
      policyId: String(depositField.fields[0]),
      assetName: String(depositField.fields[1]),
    },
    opdPayment: {
      policyId: String(paymentField.fields[0]),
      assetName: String(paymentField.fields[1]),
    },
    opdPrice: {
      numerator: BigInt(priceField.fields[0]),
      denominator: BigInt(priceField.fields[1]),
    },
    opdSellerKey: String(sellerKeyField),
  };
}

/**
 * Calculates the required payment for executing `amount` options.
 * Ceiling division: ceil((amount * numerator) / denominator).
 */
export function calculateRequiredPayment(
  amount: bigint,
  strikePrice: Rational
): bigint {
  if (amount <= 0n) return 0n;
  const num = strikePrice.numerator;
  const den = strikePrice.denominator;
  return (amount * num + den - 1n) / den;
}

import { patchProviderEvaluation } from "../services/lucid";

// =========================================================================
// TRANSACTION BUILDERS
// =========================================================================

/**
 * Builds transaction to create and fund a new Option position.
 *
 * Mints:
 * - 1 Position NFT -> locked at option validator script
 * - N Option tokens -> delivered to seller's wallet
 *
 * Deposits:
 * - N deposit tokens + 3 ADA minAda -> locked at option validator script with inline OptionDatum
 */
export async function createOptionTx(
  lucid: LucidEvolution,
  params: CreateOptionParams
): Promise<{
  tx: TxSignBuilder;
  tokenName: string;
  optionUnit: string;
  nftUnit: string;
  datum: OptionDatum;
}> {
  const sellerPkh = paymentCredentialOf(params.sellerAddress).hash;
  const net = (lucid.config().network === "Mainnet" || params.sellerAddress.startsWith("addr1")) ? "Mainnet" : "Preprod";
  const validatorAddress = validatorToAddress(net, OPTIONS_SCRIPTS.validator);

  // Time boundaries:
  // - European: opdStart = opdEnd - 1 day (86_400_000 ms)
  // - American: opdStart = now
  const now = Date.now();
  let startTimeMs = params.startTimeMs;
  if (startTimeMs === undefined) {
    if (params.style === "European") {
      startTimeMs = Math.max(now, params.expirationTimeMs - 86_400_000);
    } else {
      startTimeMs = Math.floor(now / 1000) * 1000 - 5000;
    }
  }

  let cancelCutoffMs = params.cancelCutoffMs;
  if (cancelCutoffMs === undefined) {
    // By default, allow cancellation up to expiration
    cancelCutoffMs = params.expirationTimeMs;
  }

  // Ensure invariants: opdStart <= opdCancelCutoff <= opdEnd
  if (startTimeMs > cancelCutoffMs) {
    cancelCutoffMs = startTimeMs;
  }
  if (cancelCutoffMs > params.expirationTimeMs) {
    cancelCutoffMs = params.expirationTimeMs;
  }

  // Select seed UTxO for opdRef
  let refUtxo = params.seedUtxo;
  if (!refUtxo) {
    const walletUtxos = await lucid.wallet().getUtxos();
    if (!walletUtxos || walletUtxos.length === 0) {
      throw new Error("No UTxOs available in seller wallet to seed option");
    }
    // Prefer a UTxO that is NOT the dedicated 10 ADA collateral UTxO
    refUtxo =
      walletUtxos.find(
        (u) =>
          !(
            Object.keys(u.assets).length === 1 &&
            (u.assets["lovelace"] || 0n) === 10_000_000n
          )
      ) || walletUtxos[0];
  }

  const tokenName = await computeOptionTokenName({
    txHash: refUtxo.txHash,
    outputIndex: refUtxo.outputIndex,
  });

  const nftUnit = OPTIONS_NFT_POLICY_HASH + tokenName;
  const optionUnit = OPTIONS_MINT_POLICY_HASH + tokenName;

  const datum: OptionDatum = {
    opdRef: {
      txHash: refUtxo.txHash,
      outputIndex: refUtxo.outputIndex,
    },
    opdToken: {
      policyId: OPTIONS_MINT_POLICY_HASH,
      assetName: tokenName,
    },
    opdStart: BigInt(startTimeMs),
    opdEnd: BigInt(params.expirationTimeMs),
    opdCancelCutoff: BigInt(cancelCutoffMs),
    opdDeposit: params.depositAsset,
    opdPayment: params.paymentAsset,
    opdPrice: params.strikePrice,
    opdSellerKey: sellerPkh,
  };

  const datumConstr = encodeOptionDatum(datum);
  const datumHex = Data.to(datumConstr);

  // Script output assets: 1 NFT + 3 ADA minAda + deposit tokens
  const scriptDepositAssets: Assets = {
    [nftUnit]: 1n,
  };

  if (isAdaAsset(params.depositAsset)) {
    scriptDepositAssets["lovelace"] = OPTION_MIN_ADA + params.depositAmount;
  } else {
    scriptDepositAssets["lovelace"] = OPTION_MIN_ADA;
    const depUnit = assetToUnit(params.depositAsset);
    scriptDepositAssets[depUnit] = params.depositAmount;
  }

  // Redeemers:
  // - NFT mint redeemer: Just ref = Constr 0 [ Constr 0 [ Constr 0 [txHash], index ] ]
  const nftMintRedeemer = Data.to(
    new Constr(0, [
      new Constr(0, [
        new Constr(0, [refUtxo.txHash]),
        BigInt(refUtxo.outputIndex),
      ]),
    ])
  );

  // - Option mint redeemer (PlutusV3 OutputReference): Constr 0 [ txHash, index ]
  const optionMintRedeemer = Data.to(
    new Constr(0, [
      refUtxo.txHash,
      BigInt(refUtxo.outputIndex),
    ])
  );

  const tx = await lucid
    .newTx()
    .collectFrom([refUtxo])
    .attach.MintingPolicy(OPTIONS_SCRIPTS.nftPolicy)
    .mintAssets({ [nftUnit]: 1n }, nftMintRedeemer)
    .attach.MintingPolicy(OPTIONS_SCRIPTS.optionPolicy)
    .mintAssets({ [optionUnit]: params.depositAmount }, optionMintRedeemer)
    .pay.ToContract(
      validatorAddress,
      { kind: "inline", value: datumHex },
      scriptDepositAssets
    )
    .complete({ localUPLCEval: false });

  return {
    tx,
    tokenName,
    optionUnit,
    nftUnit,
    datum,
  };
}

/**
 * Helper to find and collect UTxOs from the connected wallet containing the required token amount.
 * This guarantees the user actually owns the tokens being burned or cancelled,
 * and feeds them explicitly into Lucid transaction inputs for coin balancing.
 */
async function collectTokenUtxos(
  lucid: LucidEvolution,
  tokenUnit: string,
  requiredAmount: bigint
): Promise<UTxO[]> {
  const userUtxos = await lucid.wallet().getUtxos();
  let collected = 0n;
  const selected: UTxO[] = [];
  for (const u of userUtxos) {
    const qty = u.assets[tokenUnit] || 0n;
    if (qty > 0n) {
      selected.push(u);
      collected += qty;
      if (collected >= requiredAmount) break;
    }
  }
  if (collected < requiredAmount) {
    throw new Error(
      `Insufficient token balance in wallet: required ${requiredAmount} of ${tokenUnit}, found ${collected}`
    );
  }
  return selected;
}

/**
 * Builds transaction to execute an active Option position (Partial or Full Execution).
 *
 * The option holder:
 * - Burns k option tokens
 * - Consumes the option script UTxO
 * - Extracts k deposit tokens to their wallet
 * - Pays at least k * strikePrice into the continuing script UTxO
 * - Preserves Position NFT and exact same OptionDatum in the continuing script output
 */
export async function executeOptionTx(
  lucid: LucidEvolution,
  params: ExecuteOptionParams
): Promise<TxSignBuilder> {
  patchProviderEvaluation(lucid);
  const { optionUtxo, amountToExecute, buyerAddress } = params;
  if (!optionUtxo.datum) {
    throw new Error("Option script UTxO missing inline datum");
  }

  const datum = decodeOptionDatum(optionUtxo.datum);
  const now = Date.now();

  if (BigInt(now) < datum.opdStart) {
    throw new Error(
      `Option execution window has not started yet. Starts at: ${new Date(
        Number(datum.opdStart)
      ).toISOString()}`
    );
  }
  if (BigInt(now) > datum.opdEnd) {
    throw new Error(
      `Option has already expired at: ${new Date(
        Number(datum.opdEnd)
      ).toISOString()}`
    );
  }

  const scripts = getOptionScriptsForUtxo(optionUtxo, datum);
  const optionUnit = datum.opdToken.policyId + datum.opdToken.assetName;
  const nftUnit = scripts.nftPolicy.hash + datum.opdToken.assetName;

  // Verify that the UTxO contains the NFT
  if ((optionUtxo.assets[nftUnit] || 0n) !== 1n) {
    throw new Error("Option UTxO is missing the tracking Position NFT");
  }

  // Calculate continuing assets
  const requiredPayment = calculateRequiredPayment(
    amountToExecute,
    datum.opdPrice
  );

  const continuingAssets: Assets = {
    ...optionUtxo.assets,
  };

  // 1. Deduct executed deposit tokens from script
  if (isAdaAsset(datum.opdDeposit)) {
    const curAda = continuingAssets["lovelace"] || 0n;
    if (curAda < OPTION_MIN_ADA + amountToExecute) {
      throw new Error("Insufficient deposit ADA remaining in script");
    }
    continuingAssets["lovelace"] = curAda - amountToExecute;
  } else {
    const depUnit = assetToUnit(datum.opdDeposit);
    const curDeposit = continuingAssets[depUnit] || 0n;
    if (curDeposit < amountToExecute) {
      throw new Error("Insufficient deposit tokens remaining in script");
    }
    continuingAssets[depUnit] = curDeposit - amountToExecute;
  }

  // Ensure minimum ADA invariant in continuing script output
  if ((continuingAssets["lovelace"] || 0n) < OPTION_MIN_ADA) {
    continuingAssets["lovelace"] = OPTION_MIN_ADA;
  }

  // 2. Strike payment is sent directly to the option seller
  const sellerPaymentAssets: Assets = {};
  if (isAdaAsset(datum.opdPayment)) {
    sellerPaymentAssets["lovelace"] = requiredPayment;
  } else {
    const payUnit = assetToUnit(datum.opdPayment);
    sellerPaymentAssets[payUnit] = requiredPayment;
    // Native asset output requires min-ADA
    sellerPaymentAssets["lovelace"] = 1_500_000n;
  }

  const net = (lucid.config().network === "Mainnet" || params.buyerAddress.startsWith("addr1")) ? "Mainnet" : "Preprod";
  const sellerDestinationAddress = credentialToAddress(net, {
    type: "Key",
    hash: datum.opdSellerKey,
  });

  // Spend redeemer: Execute amount = Constr 0 [ amount ]
  const spendRedeemer = Data.to(new Constr(0, [BigInt(amountToExecute)]));

  // Mint redeemer for burning option tokens (PlutusV3 OutputReference): Constr 0 [ txHash, index ]
  const optionBurnRedeemer = Data.to(
    new Constr(0, [
      datum.opdRef.txHash,
      BigInt(datum.opdRef.outputIndex),
    ])
  );

  // Time validity range: must be within [opdStart, opdEnd]
  // Use Math.max(opdStart, now - 30_000) so lower bound slot conversion safely stays >= opdStart
  const validFromTime = Math.max(Number(datum.opdStart), now - 30_000);
  const validToTime = Math.min(Number(datum.opdEnd), now + 120_000);

  const userUtxos = await collectTokenUtxos(
    lucid,
    optionUnit,
    BigInt(amountToExecute)
  );

  const tx = await lucid
    .newTx()
    .collectFrom([optionUtxo], spendRedeemer)
    .collectFrom(userUtxos)
    .attach.SpendingValidator(scripts.validator)
    .attach.MintingPolicy(scripts.optionPolicy)
    .mintAssets({ [optionUnit]: -BigInt(amountToExecute) }, optionBurnRedeemer)
    .pay.ToContract(
      optionUtxo.address,
      { kind: "inline", value: optionUtxo.datum },
      continuingAssets
    )
    .pay.ToAddress(sellerDestinationAddress, sellerPaymentAssets)
    .validFrom(validFromTime)
    .validTo(validToTime)
    .complete({ localUPLCEval: false });

  return tx;
}

/**
 * Builds transaction to retrieve remaining deposit and accumulated strike payments after expiration.
 *
 * Option writer:
 * - Signs the transaction (verified against opdSellerKey)
 * - Burns Position NFT (PDNothing redeemer = Constr 1 [])
 * - Consumes option script UTxO with Retrieve redeemer (Constr 1 [])
 * - Reclaims all remaining assets to their wallet
 */
export async function retrieveOptionTx(
  lucid: LucidEvolution,
  params: RetrieveOptionParams
): Promise<TxSignBuilder> {
  patchProviderEvaluation(lucid);
  const { optionUtxo, sellerAddress } = params;
  if (!optionUtxo.datum) {
    throw new Error("Option script UTxO missing inline datum");
  }

  const datum = decodeOptionDatum(optionUtxo.datum);
  const sellerPkh = paymentCredentialOf(sellerAddress).hash;

  const isOwner =
    sellerPkh.toLowerCase() === datum.opdSellerKey.toLowerCase() ||
    Boolean(
      params.userPkhs &&
        params.userPkhs.map((p) => p.toLowerCase()).includes(datum.opdSellerKey.toLowerCase())
    );

  if (!isOwner) {
    throw new Error("Connected wallet does not own opdSellerKey");
  }

  const now = Date.now();
  if (BigInt(now) < datum.opdEnd) {
    throw new Error(
      `Cannot retrieve before option expiration. Expires at: ${new Date(
        Number(datum.opdEnd)
      ).toISOString()}`
    );
  }

  const scripts = getOptionScriptsForUtxo(optionUtxo, datum);
  const nftUnit = scripts.nftPolicy.hash + datum.opdToken.assetName;

  // Retrieve redeemer = Constr 1 []
  const retrieveRedeemer = Data.to(new Constr(1, []));

  // NFT burn redeemer: PDNothing = Constr 1 []
  const nftBurnRedeemer = Data.to(new Constr(1, []));

  // Transfer all remaining assets except the burned NFT back to seller
  const refundAssets: Assets = { ...optionUtxo.assets };
  delete refundAssets[nftUnit];

  // The on-chain Retrieve validator requires funds to go to an address whose payment credential matches opdSellerKey
  let refundAddress = sellerAddress;
  if (sellerPkh.toLowerCase() !== datum.opdSellerKey.toLowerCase()) {
    const net = (lucid.config().network === "Mainnet" || sellerAddress.startsWith("addr1")) ? "Mainnet" : "Preprod";
    try {
      const details = getAddressDetails(sellerAddress);
      refundAddress = credentialToAddress(
        net,
        { type: "Key", hash: datum.opdSellerKey },
        details.stakeCredential
      );
    } catch {
      refundAddress = credentialToAddress(net, {
        type: "Key",
        hash: datum.opdSellerKey,
      });
    }
  }

  const tx = await lucid
    .newTx()
    .collectFrom([optionUtxo], retrieveRedeemer)
    .attach.SpendingValidator(scripts.validator)
    .attach.MintingPolicy(scripts.nftPolicy)
    .mintAssets({ [nftUnit]: -1n }, nftBurnRedeemer)
    .pay.ToAddress(refundAddress, refundAssets)
    .addSignerKey(datum.opdSellerKey)
    .validFrom(Math.floor(Number(datum.opdEnd) / 1000) * 1000 + 1000)
    .complete({ localUPLCEval: false });

  return tx;
}

/**
 * Builds transaction for writer to cancel early before opdCancelCutoff.
 *
 * Option writer:
 * - Signs the transaction (verified against opdSellerKey)
 * - Must occur before opdCancelCutoff
 * - Burns ALL remaining unsold option tokens
 * - Burns Position NFT (PDNothing redeemer = Constr 1 [])
 * - Consumes option script UTxO with CancelEarly redeemer (Constr 2 [])
 * - Reclaims 100% of deposited tokens + 3 ADA minAda
 */
export async function cancelEarlyOptionTx(
  lucid: LucidEvolution,
  params: CancelEarlyOptionParams
): Promise<TxSignBuilder> {
  patchProviderEvaluation(lucid);
  const { optionUtxo, sellerAddress } = params;
  if (!optionUtxo.datum) {
    throw new Error("Option script UTxO missing inline datum");
  }

  const datum = decodeOptionDatum(optionUtxo.datum);
  const sellerPkh = paymentCredentialOf(sellerAddress).hash;

  const isOwner =
    sellerPkh.toLowerCase() === datum.opdSellerKey.toLowerCase() ||
    Boolean(
      params.userPkhs &&
        params.userPkhs.map((p) => p.toLowerCase()).includes(datum.opdSellerKey.toLowerCase())
    );

  if (!isOwner) {
    throw new Error("Connected wallet does not own opdSellerKey");
  }

  const now = Date.now();
  if (BigInt(now) >= datum.opdCancelCutoff) {
    throw new Error(
      `Cancel cutoff has already passed at: ${new Date(
        Number(datum.opdCancelCutoff)
      ).toISOString()}`
    );
  }

  const scripts = getOptionScriptsForUtxo(optionUtxo, datum);
  const nftUnit = scripts.nftPolicy.hash + datum.opdToken.assetName;
  const optionUnit = datum.opdToken.policyId + datum.opdToken.assetName;

  // In Option.hs:
  // unsoldTokensBurnt = assetClassValueOf mint opdToken == negate remainingDeposit
  // where remainingDeposit | opdDeposit == adaAC = ownValue ada - 3_000_000
  //                        | otherwise           = ownValue opdDeposit
  let remainingDeposit: bigint;
  if (isAdaAsset(datum.opdDeposit)) {
    remainingDeposit = (optionUtxo.assets["lovelace"] || 0n) - OPTION_MIN_ADA;
  } else {
    const depUnit = assetToUnit(datum.opdDeposit);
    remainingDeposit = optionUtxo.assets[depUnit] || 0n;
  }

  if (remainingDeposit <= 0n) {
    throw new Error("No remaining deposit to cancel");
  }

  const amountToCancel = params.amountToCancel ?? remainingDeposit;
  if (amountToCancel <= 0n || amountToCancel > remainingDeposit) {
    throw new Error(
      `Invalid cancel amount: ${amountToCancel}. Must be between 1 and ${remainingDeposit}`
    );
  }

  // CancelEarly redeemer = Constr 2 [ amountToCancel ]
  const cancelRedeemer = Data.to(new Constr(2, [BigInt(amountToCancel)]));

  // Option burn redeemer (PlutusV3 OutputReference): Constr 0 [ txHash, index ]
  const optionBurnRedeemer = Data.to(
    new Constr(0, [
      datum.opdRef.txHash,
      BigInt(datum.opdRef.outputIndex),
    ])
  );

  // Validity range: must be before opdCancelCutoff - 1
  const validToTime = Math.min(
    Number(datum.opdCancelCutoff) - 2000,
    now + 120_000
  );

  if (amountToCancel === remainingDeposit) {
    // -------------------------------------------------------------
    // Full Cancellation: All remaining options cancelled, position closed
    // -------------------------------------------------------------
    // NFT burn redeemer: PDNothing = Constr 1 []
    const nftBurnRedeemer = Data.to(new Constr(1, []));

    // Return all remaining assets except burned NFT to seller
    const refundAssets: Assets = { ...optionUtxo.assets };
    delete refundAssets[nftUnit];

    const userUtxos = await collectTokenUtxos(
      lucid,
      optionUnit,
      remainingDeposit
    );

    const tx = await lucid
      .newTx()
      .collectFrom([optionUtxo], cancelRedeemer)
      .collectFrom(userUtxos)
      .attach.SpendingValidator(scripts.validator)
      .attach.MintingPolicy(scripts.nftPolicy)
      .mintAssets({ [nftUnit]: -1n }, nftBurnRedeemer)
      .attach.MintingPolicy(scripts.optionPolicy)
      .mintAssets({ [optionUnit]: -remainingDeposit }, optionBurnRedeemer)
      .pay.ToAddress(sellerAddress, refundAssets)
      .addSignerKey(datum.opdSellerKey)
      .validTo(validToTime)
      .complete({ localUPLCEval: false });

    return tx;
  } else {
    // -------------------------------------------------------------
    // Partial Cancellation: Seller cancels only `amountToCancel` unsold options
    // Remaining options stay active and 100% backed in continuing script UTxO!
    // -------------------------------------------------------------
    const continuingAssets: Assets = {
      ...optionUtxo.assets,
    };

    const refundAssets: Assets = {};

    if (isAdaAsset(datum.opdDeposit)) {
      const curAda = continuingAssets["lovelace"] || 0n;
      continuingAssets["lovelace"] = curAda - amountToCancel;
      refundAssets["lovelace"] = amountToCancel;
    } else {
      const depUnit = assetToUnit(datum.opdDeposit);
      const curDeposit = continuingAssets[depUnit] || 0n;
      continuingAssets[depUnit] = curDeposit - amountToCancel;
      refundAssets[depUnit] = amountToCancel;
      // Ensure minAda is retained in continuing script UTxO
      if ((continuingAssets["lovelace"] || 0n) < OPTION_MIN_ADA) {
        continuingAssets["lovelace"] = OPTION_MIN_ADA;
      }
    }

    const userUtxos = await collectTokenUtxos(
      lucid,
      optionUnit,
      amountToCancel
    );

    const tx = await lucid
      .newTx()
      .collectFrom([optionUtxo], cancelRedeemer)
      .collectFrom(userUtxos)
      .attach.SpendingValidator(scripts.validator)
      .attach.MintingPolicy(scripts.optionPolicy)
      .mintAssets({ [optionUnit]: -amountToCancel }, optionBurnRedeemer)
      .pay.ToContract(
        optionUtxo.address,
        { kind: "inline", value: optionUtxo.datum },
        continuingAssets
      )
      .pay.ToAddress(sellerAddress, refundAssets)
      .addSignerKey(datum.opdSellerKey)
      .validTo(validToTime)
      .complete({ localUPLCEval: false });

    return tx;
  }
}

// =========================================================================
// HIGH-LEVEL CONVENIENCE EXECUTION WRAPPERS
// =========================================================================

export async function createOption(
  lucid: LucidEvolution,
  params: CreateOptionParams
): Promise<{
  txHash: string;
  tokenName: string;
  optionUnit: string;
  nftUnit: string;
  datum: OptionDatum;
}> {
  const { tx, tokenName, optionUnit, nftUnit, datum } = await createOptionTx(
    lucid,
    params
  );
  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  return { txHash, tokenName, optionUnit, nftUnit, datum };
}

export async function executeOption(
  lucid: LucidEvolution,
  params: ExecuteOptionParams
): Promise<{ txHash: string }> {
  const tx = await executeOptionTx(lucid, params);
  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  return { txHash };
}

export async function retrieveOption(
  lucid: LucidEvolution,
  params: RetrieveOptionParams
): Promise<{ txHash: string }> {
  const tx = await retrieveOptionTx(lucid, params);
  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  return { txHash };
}

export async function cancelEarlyOption(
  lucid: LucidEvolution,
  params: CancelEarlyOptionParams
): Promise<{ txHash: string }> {
  const tx = await cancelEarlyOptionTx(lucid, params);
  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  return { txHash };
}

