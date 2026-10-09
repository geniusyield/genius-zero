import {
  type Assets,
  type Credential,
  type LucidEvolution,
  type UTxO,
  Constr,
  Data,
  credentialToAddress,
  credentialToRewardAddress,
  getAddressDetails,
  paymentCredentialOf,
  fromHex,
  toHex,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { LiquidityVault, NetworkType } from "../types/index";
import { DEX_CONSTANTS, DexNetworkConstants } from "../config/dex";
import { patchProviderEvaluation } from "../services/lucid";
import {
  SignedOracleCertificate,
  buildPriceTimestampConstr,
} from "../services/oracle";

/**
 * Decodes a Plutus-encoded Address into a Bech32 Cardano address.
 */
export function decodePlutusAddress(
  plAddr: any,
  network: "Mainnet" | "Preprod" | "Preview" | "Custom"
): string {
  if (!plAddr || !plAddr.fields || plAddr.fields.length < 2) {
    throw new Error("Invalid Plutus Address structure");
  }

  // Payment credential: Constr 0 = VerificationKeyHash, Constr 1 = ScriptHash
  const payType = plAddr.fields[0].index === 1 ? "Script" : "Key";
  const payHash = String(plAddr.fields[0].fields[0]);
  const paymentCredential: Credential = {
    type: payType,
    hash: payHash,
  };

  // Stake credential: Option<StakeCredential>
  let stakeCredential: Credential | undefined = undefined;
  if (plAddr.fields[1].index === 0 && plAddr.fields[1].fields?.length > 0) {
    const stakeObj = plAddr.fields[1].fields[0];
    if (stakeObj.index === 0 && stakeObj.fields?.length > 0) {
      const credObj = stakeObj.fields[0];
      const sType = credObj.index === 1 ? "Script" : "Key";
      const sHash = String(credObj.fields[0]);
      stakeCredential = {
        type: sType,
        hash: sHash,
      };
    }
  }

  return credentialToAddress(network, paymentCredential, stakeCredential);
}

/**
 * Encodes a Bech32 Cardano address into Plutus Address structure.
 */
export function encodePlutusAddress(addr: string): Constr<any> {
  const { paymentCredential, stakeCredential } = getAddressDetails(addr);
  if (!paymentCredential) {
    throw new Error(`Invalid payment address: ${addr}`);
  }

  const payConstr =
    paymentCredential.type === "Key"
      ? new Constr(0, [paymentCredential.hash])
      : new Constr(1, [paymentCredential.hash]);

  let stakeConstr: Constr<any>;
  if (stakeCredential) {
    const credConstr =
      stakeCredential.type === "Key"
        ? new Constr(0, [stakeCredential.hash])
        : new Constr(1, [stakeCredential.hash]);
    stakeConstr = new Constr(0, [new Constr(0, [credConstr])]);
  } else {
    stakeConstr = new Constr(1, []);
  }

  return new Constr(0, [payConstr, stakeConstr]);
}

/**
 * Encodes asset details into Plutus AssetDetails structure:
 * AssetClass { policy: ByteArray, token: ByteArray }, amount: Int
 */
export function encodeAssetDetails(
  policyHex: string,
  tokenHex: string,
  amount: bigint
): Constr<any> {
  return new Constr(0, [new Constr(0, [policyHex, tokenHex]), amount]);
}

/**
 * Computes the 29-byte order NFT token name for Two-Way Orders (SLV).
 *
 * Formula: 0x01 || slice_{0..27}(sha256(outputIndexByte || txIdBytes))
 * Result: 58 hex characters starting with 01.
 */
export async function computeNftTokenName(
  txHash: string,
  outputIndex: number,
  orderIndex: number = 1
): Promise<string> {
  const hexByte = outputIndex.toString(16).padStart(2, "0");
  const stringToHash = `${hexByte}${txHash}`;
  const bytes = fromHex(stringToHash);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  const hashArray = new Uint8Array(hashBuffer);
  const slice28 = hashArray.slice(0, 28);
  const result = new Uint8Array(29);
  result.set([orderIndex], 0);
  result.set(slice28, 1);
  return toHex(result);
}

/**
 * Calculates net offer amount from gross offer amount using maker fee ratio.
 * Matches Aiken: (gross * denominator + total - 1) / total where total = denominator + numerator.
 */
export function netFromGross(
  gross: bigint,
  makerFeeRatio: { numerator: bigint; denominator: bigint }
): bigint {
  if (gross <= 0n) return gross;
  const num = makerFeeRatio.numerator;
  const den = makerFeeRatio.denominator;
  const total = den + num;
  if (total <= 0n) return gross;
  return (gross * den + total - 1n) / total;
}

/**
 * Calculates ceil( (net * priceNumerator) / priceDenominator ).
 */
export function ceilMulRatio(
  amount: bigint,
  price: { numerator: bigint; denominator: bigint }
): bigint {
  if (amount <= 0n || price.numerator <= 0n) return 0n;
  const den = price.denominator;
  return (amount * price.numerator + den - 1n) / den;
}

/**
 * Calculates floor( (amount * ratioNumerator) / ratioDenominator ).
 */
export function floorMulRatio(
  amount: bigint,
  ratio: { numerator: bigint; denominator: bigint }
): bigint {
  if (amount <= 0n || ratio.numerator <= 0n) return 0n;
  return (amount * ratio.numerator) / ratio.denominator;
}

/**
 * Applies PriceDelta to oracle price: Price = oraclePrice * (1 + spread) + offset.
 */
export function applyPriceDelta(
  oraclePrice: { numerator: bigint; denominator: bigint },
  delta: {
    offset: { numerator: bigint; denominator: bigint };
    spread: { numerator: bigint; denominator: bigint };
  }
): { numerator: bigint; denominator: bigint } {
  const sNum = delta.spread.denominator + delta.spread.numerator;
  const sDen = delta.spread.denominator;

  const baseNum = oraclePrice.numerator * sNum;
  const baseDen = oraclePrice.denominator * sDen;

  const finalNum =
    baseNum * delta.offset.denominator + delta.offset.numerator * baseDen;
  const finalDen = baseDen * delta.offset.denominator;

  if (finalNum <= 0n || finalDen <= 0n) {
    throw new Error(
      `Invalid non-positive price derived from oracle and delta: ${finalNum}/${finalDen}`
    );
  }

  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  const g = gcd(finalNum, finalDen);
  return { numerator: finalNum / g, denominator: finalDen / g };
}

// In-memory cache for reference UTxOs
const slvRefUTxOsCache = new Map<
  string,
  {
    configUtxo: UTxO;
    mintRefUtxo: UTxO;
    spendRefUtxo: UTxO;
    cancelRefUtxo: UTxO;
    fillRefUtxo?: UTxO;
  }
>();

/**
 * Fetches and caches the required reference UTxOs for SLV operations:
 * 1. Config UTxO (holds two-way order global config datum & ref NFT)
 * 2. Mint reference script (mints & burns the order tracking NFT)
 * 3. Spend reference script (SLV validator at order script address)
 * 4. Cancel reference script (stake validator verifying ownership & burning)
 * 5. Fill reference script (stake validator verifying fill & oracle certificate)
 */
export async function fetchSlvRefUTxOs(
  lucid: LucidEvolution,
  constants: DexNetworkConstants
): Promise<{
  configUtxo: UTxO;
  mintRefUtxo: UTxO;
  spendRefUtxo: UTxO;
  cancelRefUtxo: UTxO;
  fillRefUtxo?: UTxO;
}> {
  const nid = lucid.config().network;
  const cached = slvRefUTxOsCache.get(nid);
  if (cached) {
    return cached;
  }

  if (
    !constants.slvConfigUTxO ||
    !constants.slvMintRef ||
    !constants.slvSpendRef ||
    !constants.slvCancelRef
  ) {
    throw new Error(
      `Reference UTxO constants for SLV are not configured for network ${nid}.`
    );
  }

  const outRefs = [
    constants.slvConfigUTxO,
    constants.slvMintRef,
    constants.slvSpendRef,
    constants.slvCancelRef,
  ];
  if (constants.slvFillRef) {
    outRefs.push(constants.slvFillRef);
  }

  const fetched = await lucid.utxosByOutRef(outRefs);

  const configUtxo = fetched.find(
    (u) =>
      u.txHash === constants.slvConfigUTxO!.txHash &&
      u.outputIndex === constants.slvConfigUTxO!.outputIndex
  );
  const mintRefUtxo = fetched.find(
    (u) =>
      u.txHash === constants.slvMintRef!.txHash &&
      u.outputIndex === constants.slvMintRef!.outputIndex
  );
  const spendRefUtxo = fetched.find(
    (u) =>
      u.txHash === constants.slvSpendRef!.txHash &&
      u.outputIndex === constants.slvSpendRef!.outputIndex
  );
  const cancelRefUtxo = fetched.find(
    (u) =>
      u.txHash === constants.slvCancelRef!.txHash &&
      u.outputIndex === constants.slvCancelRef!.outputIndex
  );
  const fillRefUtxo = constants.slvFillRef
    ? fetched.find(
        (u) =>
          u.txHash === constants.slvFillRef!.txHash &&
          u.outputIndex === constants.slvFillRef!.outputIndex
      )
    : undefined;

  if (!configUtxo || !mintRefUtxo || !spendRefUtxo || !cancelRefUtxo) {
    throw new Error(
      `Failed to fetch required SLV reference UTxOs on ${nid}: config=${!!configUtxo}, mint=${!!mintRefUtxo}, spend=${!!spendRefUtxo}, cancel=${!!cancelRefUtxo}`
    );
  }

  const result = {
    configUtxo,
    mintRefUtxo,
    spendRefUtxo,
    cancelRefUtxo,
    fillRefUtxo,
  };

  slvRefUTxOsCache.set(nid, result);
  return result;
}

/**
 * Builds and submits a transaction to cancel an active Smart Liquidity Vault (Two-Way Order).
 *
 * Contract mechanics:
 * 1. Reads from config, mint, spend, and cancel reference UTxOs.
 * 2. Spends the order UTxO with CancelOrder redeemer (Constr 0 []).
 * 3. Burns the order tracking NFT (-1) with Option::None redeemer (Constr 1 []).
 * 4. Executes the cancel stake validator with a 0-ADA withdrawal and void redeemer (Constr 0 []).
 * 5. Returns all locked assets (lovelace + tokens) to the owner's payment address with an
 *    inline datum containing the NFT token name (as required by traverse_cancel_outputs).
 * 6. Adds the owner's verification key hash to required signatories.
 */
export async function cancelLiquidityVault(
  lucid: LucidEvolution,
  vault: LiquidityVault
): Promise<string> {
  patchProviderEvaluation(lucid);
  const network = lucid.config().network.toLowerCase() as NetworkType;
  const constants = DEX_CONSTANTS[network];
  if (!constants || !constants.slvNftPolicyId) {
    throw new Error(`SLV cancellation is not supported on network: ${network}`);
  }

  // 1. Fetch current on-chain vault UTxO
  const [vaultUtxo] = await lucid.utxosByOutRef([vault.utxoRef]);
  if (!vaultUtxo) {
    throw new Error(
      "Vault position is no longer active on-chain (already cancelled or filled)."
    );
  }

  // 2. Resolve datum
  const rawDatum = vaultUtxo.datum || vault.rawDatumHex;
  if (!rawDatum) {
    throw new Error("Unable to locate on-chain datum for this vault position.");
  }
  const parsed = Data.from(rawDatum) as any;
  if (!parsed.fields || parsed.fields.length < 3) {
    throw new Error("Unexpected datum structure in SLV UTxO.");
  }

  // Owner PKH (fields[0].fields[0][0])
  const ownerPkh = String(
    parsed.fields[0]?.fields?.[0]?.[0] || vault.ownerKey
  );
  if (!ownerPkh) {
    throw new Error("Could not determine owner verification key hash.");
  }

  // Payment Address (fields[1])
  const paymentAddr = decodePlutusAddress(
    parsed.fields[1],
    lucid.config().network
  );

  // NFT Token Name (fields[2])
  const nftTokenName = String(parsed.fields[2] || vault.nftTokenName);
  const nftUnit = `${constants.slvNftPolicyId}${nftTokenName}`;

  // 3. Fetch reference scripts and config
  const { configUtxo, mintRefUtxo, spendRefUtxo, cancelRefUtxo } =
    await fetchSlvRefUTxOs(lucid, constants);

  // 4. Resolve cancel stake address
  let cancelStakeAddr = constants.slvCancelStakeAddr;
  if (!cancelStakeAddr) {
    if (cancelRefUtxo.scriptRef) {
      // Derive stake address from script hash
      const scriptHash = validatorToScriptHash(
        cancelRefUtxo.scriptRef
      );
      cancelStakeAddr = credentialToRewardAddress(lucid.config().network, {
        type: "Script",
        hash: scriptHash,
      });
    } else {
      throw new Error("Cancel stake address is neither configured nor derivable from reference script.");
    }
  }

  // 5. Calculate payout assets (all assets in the UTxO minus the 1 NFT to burn)
  const payoutAssets: Assets = { ...vaultUtxo.assets };
  delete payoutAssets[nftUnit];

  // 6. Build the transaction
  const tx = lucid
    .newTx()
    .readFrom([configUtxo, mintRefUtxo, cancelRefUtxo, spendRefUtxo])
    .collectFrom([vaultUtxo], Data.to(new Constr(0, [])))
    .mintAssets({ [nftUnit]: -1n }, Data.to(new Constr(1, [])))
    .withdraw(cancelStakeAddr, 0n, Data.void())
    .pay.ToAddressWithData(
      paymentAddr,
      {
        kind: "inline",
        value: Data.to(nftTokenName),
      },
      payoutAssets
    )
    .addSignerKey(ownerPkh);

  // 7. Complete, sign with user wallet, submit (use provider for Plutus V3 evaluation)
  const completedTx = await tx.complete({ localUPLCEval: false });
  const signedTx = await completedTx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  return txHash;
}

/**
 * Builds and submits a batch transaction to cancel multiple active Smart Liquidity Vaults.
 */
export async function cancelLiquidityVaults(
  lucid: LucidEvolution,
  vaults: LiquidityVault[]
): Promise<string> {
  if (vaults.length === 0) {
    throw new Error("No vaults provided for cancellation.");
  }
  if (vaults.length === 1) {
    return cancelLiquidityVault(lucid, vaults[0]);
  }

  const network = lucid.config().network.toLowerCase() as NetworkType;
  patchProviderEvaluation(lucid);
  const constants = DEX_CONSTANTS[network];
  if (!constants || !constants.slvNftPolicyId) {
    throw new Error(`SLV cancellation is not supported on network: ${network}`);
  }

  const { configUtxo, mintRefUtxo, spendRefUtxo, cancelRefUtxo } =
    await fetchSlvRefUTxOs(lucid, constants);

  let cancelStakeAddr = constants.slvCancelStakeAddr;
  if (!cancelStakeAddr) {
    if (cancelRefUtxo.scriptRef) {
      const scriptHash = validatorToScriptHash(
        cancelRefUtxo.scriptRef
      );
      cancelStakeAddr = credentialToRewardAddress(lucid.config().network, {
        type: "Script",
        hash: scriptHash,
      });
    } else {
      throw new Error("Cancel stake address is neither configured nor derivable.");
    }
  }

  const vaultUtxos = await lucid.utxosByOutRef(vaults.map((v) => v.utxoRef));
  if (vaultUtxos.length !== vaults.length) {
    throw new Error("One or more selected vaults are no longer active on-chain.");
  }

  let tx = lucid
    .newTx()
    .readFrom([configUtxo, mintRefUtxo, cancelRefUtxo, spendRefUtxo])
    .withdraw(cancelStakeAddr, 0n, Data.void());

  const burnAssets: Assets = {};
  const signers = new Set<string>();

  for (const vault of vaults) {
    const vaultUtxo = vaultUtxos.find(
      (u) =>
        u.txHash === vault.utxoRef.txHash &&
        u.outputIndex === vault.utxoRef.outputIndex
    );
    if (!vaultUtxo) continue;

    const rawDatum = vaultUtxo.datum || vault.rawDatumHex;
    if (!rawDatum) throw new Error(`Missing datum for vault ${vault.nftTokenName}`);

    const parsed = Data.from(rawDatum) as any;
    const ownerPkh = String(
      parsed.fields[0]?.fields?.[0]?.[0] || vault.ownerKey
    );
    signers.add(ownerPkh);

    const paymentAddr = decodePlutusAddress(
      parsed.fields[1],
      lucid.config().network
    );
    const nftTokenName = String(parsed.fields[2] || vault.nftTokenName);
    const nftUnit = `${constants.slvNftPolicyId}${nftTokenName}`;

    burnAssets[nftUnit] = -1n;

    const payoutAssets: Assets = { ...vaultUtxo.assets };
    delete payoutAssets[nftUnit];

    tx = tx
      .collectFrom([vaultUtxo], Data.to(new Constr(0, [])))
      .pay.ToAddressWithData(
        paymentAddr,
        {
          kind: "inline",
          value: Data.to(nftTokenName),
        },
        payoutAssets
      );
  }

  tx = tx.mintAssets(burnAssets, Data.to(new Constr(1, [])));

  for (const signer of signers) {
    tx = tx.addSignerKey(signer);
  }

  const completedTx = await tx.complete({ localUPLCEval: false });
  const signedTx = await completedTx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  return txHash;
}

export interface CreateLiquidityVaultParams {
  ownerAddress: string;
  offeredAsset: {
    policyId: string;
    assetName: string;
    amount: bigint;
  };
  askedAsset: {
    policyId: string;
    assetName: string;
    amount?: bigint;
  };
  pricing:
    | {
        type: "fixed";
        price: { numerator: bigint; denominator: bigint };
        reversePrice?: { numerator: bigint; denominator: bigint };
      }
    | {
        type: "oracle";
        oraclePubKeyHex: string;
        offset: { numerator: bigint; denominator: bigint };
        spread: { numerator: bigint; denominator: bigint };
        reverseOffset?: { numerator: bigint; denominator: bigint };
        reverseSpread?: { numerator: bigint; denominator: bigint };
      };
  validityStart?: bigint;
  validityEnd?: bigint;
}

/**
 * Builds and submits a transaction to create a new Smart Liquidity Vault (Two-Way Order).
 *
 * Contract mechanics:
 * 1. Spends a unique wallet UTxO (nftRef) to guarantee order NFT uniqueness.
 * 2. Mints 1 NFT under slvNftPolicyId with MintRedeemer::Some(OutputReferenceInt).
 * 3. Pays 3 ADA deposit + deposited assets + 1 NFT to constants.slvAddr with inline OrderDatum.
 * 4. Pays protocol maker flat fee (0.9 ADA) to feeAddr with inline datum = slvNftPolicyId (MUST BE 1ST OUTPUT).
 * 5. Attaches owner verification key hash to required signers.
 */
export async function createLiquidityVault(
  lucid: LucidEvolution,
  params: CreateLiquidityVaultParams
): Promise<{ txHash: string; nftTokenName: string; nftUnit: string }> {
  patchProviderEvaluation(lucid);
  const network = lucid.config().network.toLowerCase() as NetworkType;
  const constants = DEX_CONSTANTS[network];
  if (!constants || !constants.slvNftPolicyId || !constants.slvAddr) {
    throw new Error(`SLV operations are not supported on network: ${network}`);
  }

  // 1. Fetch reference scripts & config
  const { configUtxo, mintRefUtxo } = await fetchSlvRefUTxOs(lucid, constants);
  const configDatum = Data.from(configUtxo.datum!) as any;
  const feeAddr = decodePlutusAddress(configDatum.fields[5], lucid.config().network);
  const makerFlatFee = BigInt(configDatum.fields[6]); // 900_000n

  // 2. Select wallet UTxO to guarantee NFT uniqueness
  const walletUtxos = await lucid.wallet().getUtxos();
  if (!walletUtxos || walletUtxos.length === 0) {
    throw new Error("No wallet UTxOs available to mint order NFT.");
  }
  const nftRefUtxo =
    walletUtxos.find((u) => !u.scriptRef && u.assets.lovelace >= 5_000_000n) ||
    walletUtxos[0];

  // 3. Compute NFT token name and mint redeemer
  const nftTokenName = await computeNftTokenName(nftRefUtxo.txHash, nftRefUtxo.outputIndex, 1);
  const nftUnit = `${constants.slvNftPolicyId}${nftTokenName}`;
  const mintRedeemer = Data.to(
    new Constr(0, [
      new Constr(0, [
        new Constr(0, [nftRefUtxo.txHash, BigInt(nftRefUtxo.outputIndex)]),
        1n,
      ]),
    ])
  );

  // 4. Resolve owner PKH
  const ownerCred = paymentCredentialOf(params.ownerAddress);
  const ownerPkh = ownerCred.hash;

  // 5. Build price Constr
  let priceConstr: Constr<any>;
  if (params.pricing.type === "fixed") {
    const revOption = params.pricing.reversePrice
      ? new Constr(0, [
          new Constr(0, [
            params.pricing.reversePrice.numerator,
            params.pricing.reversePrice.denominator,
          ]),
        ])
      : new Constr(1, []);
    priceConstr = new Constr(0, [
      new Constr(0, [
        params.pricing.price.numerator,
        params.pricing.price.denominator,
      ]),
      revOption,
    ]);
  } else {
    const revOption =
      params.pricing.reverseOffset && params.pricing.reverseSpread
        ? new Constr(0, [
            new Constr(0, [
              new Constr(0, [
                params.pricing.reverseOffset.numerator,
                params.pricing.reverseOffset.denominator,
              ]),
              new Constr(0, [
                params.pricing.reverseSpread.numerator,
                params.pricing.reverseSpread.denominator,
              ]),
            ]),
          ])
        : new Constr(1, []);
    priceConstr = new Constr(1, [
      params.pricing.oraclePubKeyHex,
      new Constr(0, [
        new Constr(0, [
          params.pricing.offset.numerator,
          params.pricing.offset.denominator,
        ]),
        new Constr(0, [
          params.pricing.spread.numerator,
          params.pricing.spread.denominator,
        ]),
      ]),
      revOption,
    ]);
  }

  // 6. Build OrderDatum
  const ownerMultisig = new Constr(0, [[ownerPkh], []]);
  const paymentAddrConstr = encodePlutusAddress(params.ownerAddress);
  const aDetails = encodeAssetDetails(
    params.offeredAsset.policyId,
    params.offeredAsset.assetName,
    params.offeredAsset.amount
  );
  const bDetails = encodeAssetDetails(
    params.askedAsset.policyId,
    params.askedAsset.assetName,
    params.askedAsset.amount ?? 0n
  );
  const valStart =
    params.validityStart != null ? new Constr(0, [params.validityStart]) : new Constr(1, []);
  const valEnd =
    params.validityEnd != null ? new Constr(0, [params.validityEnd]) : new Constr(1, []);
  const takerFlat = BigInt(configDatum.fields[8]); // 900_000n
  const takerRatio = configDatum.fields[9];
  const makerRatio = configDatum.fields[7]; // maker_fee_ratio (3/1000)
  const freshness = BigInt(configDatum.fields[10]); // oracle_freshness_seconds (60)

  const orderDatum = new Constr(0, [
    ownerMultisig,
    paymentAddrConstr,
    nftTokenName,
    aDetails,
    bDetails,
    priceConstr,
    valStart,
    valEnd,
    takerFlat,
    takerRatio,
    makerRatio,
    freshness,
  ]);

  // 7. Calculate output assets
  const minDeposit = BigInt(configDatum.fields[11] || 3_000_000n);
  const orderAssets: Assets = {};
  const isOfferedAda =
    !params.offeredAsset.policyId ||
    params.offeredAsset.policyId === "" ||
    params.offeredAsset.policyId === "lovelace";
  const isAskedAda =
    !params.askedAsset.policyId ||
    params.askedAsset.policyId === "" ||
    params.askedAsset.policyId === "lovelace";

  let totalLovelace = minDeposit;
  if (isOfferedAda) {
    totalLovelace += params.offeredAsset.amount;
  } else {
    const unitA = `${params.offeredAsset.policyId}${params.offeredAsset.assetName}`;
    orderAssets[unitA] = params.offeredAsset.amount;
  }

  if (params.askedAsset.amount && params.askedAsset.amount > 0n) {
    if (isAskedAda) {
      totalLovelace += params.askedAsset.amount;
    } else {
      const unitB = `${params.askedAsset.policyId}${params.askedAsset.assetName}`;
      orderAssets[unitB] = params.askedAsset.amount;
    }
  }
  orderAssets["lovelace"] = totalLovelace;
  orderAssets[nftUnit] = 1n;

  // 8. Build transaction
  // IMPORTANT: Protocol fee output MUST be first output in transaction!
  let tx = lucid.newTx();
  if (makerFlatFee > 0n) {
    tx = tx.pay.ToAddressWithData(
      feeAddr,
      {
        kind: "inline",
        value: Data.to(constants.slvNftPolicyId),
      },
      { lovelace: makerFlatFee }
    );
  }

  tx = tx
    .pay.ToAddressWithData(
      constants.slvAddr,
      {
        kind: "inline",
        value: Data.to(orderDatum),
      },
      orderAssets
    )
    .readFrom([configUtxo, mintRefUtxo])
    .collectFrom([nftRefUtxo])
    .mintAssets({ [nftUnit]: 1n }, mintRedeemer)
    .addSignerKey(ownerPkh);

  const completedTx = await tx.complete({ localUPLCEval: false });
  const signedTx = await completedTx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  return { txHash, nftTokenName, nftUnit };
}

export interface FillLiquidityVaultParams {
  vault: LiquidityVault;
  fillAmount: bigint;
  direction?: "straight" | "reverse";
  oracleCertificate?: SignedOracleCertificate;
  recipientAddress?: string;
}

/**
 * Builds and submits a transaction to fill (trade against) an active Smart Liquidity Vault.
 *
 * Contract mechanics:
 * 1. Spends the vault UTxO with OrderRedeemer::FillOrder (Constr 1 []).
 * 2. Withdraws 0 lovelace from slvFillStakeAddr witnessed by slvFillRef.
 *    - Fixed price: redeemer is Constr 0 [[]].
 *    - DeltaOracle: redeemer is Constr 0 [[[nftTokenName, Constr 0 [signatureHex, PriceTimestamp]]]].
 * 3. Pays continuing output with updated AssetDetails back to constants.slvAddr.
 * 4. Pays protocol fee output (taker flat fee + maker/taker proportional fees) to feeAddr with inline slvNftPolicyId.
 * 5. Returns bought tokens (offerNet) to taker recipient.
 * 6. Sets transaction validity bounds within oracle price freshness interval.
 */
export async function fillLiquidityVault(
  lucid: LucidEvolution,
  params: FillLiquidityVaultParams
): Promise<string> {
  patchProviderEvaluation(lucid);
  const network = lucid.config().network.toLowerCase() as NetworkType;
  const constants = DEX_CONSTANTS[network];
  if (!constants || !constants.slvNftPolicyId || !constants.slvAddr) {
    throw new Error(`SLV fill is not supported on network: ${network}`);
  }

  // 1. Fetch current on-chain vault UTxO
  const [vaultUtxo] = await lucid.utxosByOutRef([params.vault.utxoRef]);
  if (!vaultUtxo) {
    throw new Error("Vault position is no longer active on-chain.");
  }

  // 2. Parse on-chain datum
  const rawDatum = vaultUtxo.datum || params.vault.rawDatumHex;
  if (!rawDatum) throw new Error("Missing on-chain datum for vault.");
  const parsed = Data.from(rawDatum) as any;

  const nftTokenName = String(parsed.fields[2] || params.vault.nftTokenName);
  const nftUnit = `${constants.slvNftPolicyId}${nftTokenName}`;

  const isStraight = params.direction !== "reverse";

  const makerRatio = {
    numerator: BigInt(parsed.fields[10].fields[0]),
    denominator: BigInt(parsed.fields[10].fields[1]),
  };
  const takerRatio = {
    numerator: BigInt(parsed.fields[9].fields[0]),
    denominator: BigInt(parsed.fields[9].fields[1]),
  };
  const takerFlatFee = BigInt(parsed.fields[8]); // 900_000n
  const freshnessSeconds = BigInt(parsed.fields[11]); // 60n

  const assetA = parsed.fields[3];
  const assetB = parsed.fields[4];
  const aPolicy = String(assetA.fields[0].fields[0]);
  const aToken = String(assetA.fields[0].fields[1]);
  const currentA = BigInt(assetA.fields[1]);

  const bPolicy = String(assetB.fields[0].fields[0]);
  const bToken = String(assetB.fields[0].fields[1]);
  const currentB = BigInt(assetB.fields[1]);

  const availableLiquidity = isStraight ? currentA : currentB;
  if (availableLiquidity <= 0n) {
    throw new Error(`Vault has no remaining ${isStraight ? "straight" : "reverse"} liquidity to fill.`);
  }
  const offerGross = params.fillAmount > availableLiquidity ? availableLiquidity : params.fillAmount;
  if (offerGross <= 0n) throw new Error("Fill amount must be positive.");

  const isAda = (pol: string) => !pol || pol === "" || pol === "lovelace";
  const unitOf = (pol: string, tok: string) => (isAda(pol) ? "lovelace" : `${pol}${tok}`);

  const offerAssetUnit = isStraight ? unitOf(aPolicy, aToken) : unitOf(bPolicy, bToken);
  const paymentAssetUnit = isStraight ? unitOf(bPolicy, bToken) : unitOf(aPolicy, aToken);

  // 3. Resolve price
  const priceField = parsed.fields[5];
  let price: { numerator: bigint; denominator: bigint };

  if (priceField.index === 0) {
    // Fixed price
    if (isStraight) {
      price = {
        numerator: BigInt(priceField.fields[0].fields[0]),
        denominator: BigInt(priceField.fields[0].fields[1]),
      };
    } else {
      if (priceField.fields[1].index !== 0) {
        throw new Error("Order does not support reverse fills (reverse price is None).");
      }
      price = {
        numerator: BigInt(priceField.fields[1].fields[0].fields[0]),
        denominator: BigInt(priceField.fields[1].fields[0].fields[1]),
      };
    }
  } else {
    // DeltaOracle
    if (!params.oracleCertificate) {
      throw new Error("Oracle certificate required to fill DeltaOracle liquidity vault.");
    }
    const oraclePrice = params.oracleCertificate.price;
    if (isStraight) {
      const delta = {
        offset: {
          numerator: BigInt(priceField.fields[1].fields[0].fields[0]),
          denominator: BigInt(priceField.fields[1].fields[0].fields[1]),
        },
        spread: {
          numerator: BigInt(priceField.fields[1].fields[1].fields[0]),
          denominator: BigInt(priceField.fields[1].fields[1].fields[1]),
        },
      };
      price = applyPriceDelta(oraclePrice, delta);
    } else {
      if (priceField.fields[2].index !== 0) {
        throw new Error("Order does not support reverse fills under dynamic pricing.");
      }
      const delta = {
        offset: {
          numerator: BigInt(priceField.fields[2].fields[0].fields[0]),
          denominator: BigInt(priceField.fields[2].fields[0].fields[1]),
        },
        spread: {
          numerator: BigInt(priceField.fields[2].fields[1].fields[0]),
          denominator: BigInt(priceField.fields[2].fields[1].fields[1]),
        },
      };
      price = applyPriceDelta(oraclePrice, delta);
    }
  }

  // 4. Calculate amounts
  const offerNet = netFromGross(offerGross, makerRatio);
  const paymentProvided = ceilMulRatio(offerNet, price);
  const makerFeeOffer = offerGross - offerNet;
  const takerFeePayment = floorMulRatio(paymentProvided, takerRatio);

  let newAAmount: bigint;
  let newBAmount: bigint;
  if (isStraight) {
    newAAmount = currentA - offerGross;
    newBAmount = currentB + paymentProvided;
    if (newAAmount < 0n) throw new Error("Fill amount exceeds available straight liquidity.");
  } else {
    newAAmount = currentA + paymentProvided;
    newBAmount = currentB - offerGross;
    if (newBAmount < 0n) throw new Error("Fill amount exceeds available reverse liquidity.");
  }

  // 5. Reference UTxOs
  const { configUtxo, spendRefUtxo, fillRefUtxo } = await fetchSlvRefUTxOs(lucid, constants);
  if (!fillRefUtxo) {
    throw new Error("Fill reference UTxO is not available.");
  }
  const configDatum = Data.from(configUtxo.datum!) as any;
  const feeAddr = decodePlutusAddress(configDatum.fields[5], lucid.config().network);
  const minDeposit = BigInt(configDatum.fields[11] || 3_000_000n);

  // 6. Build updated continuing OrderDatum
  const updatedDatum = new Constr(0, [
    parsed.fields[0], // owner
    parsed.fields[1], // paymentAddr
    parsed.fields[2], // nftName
    encodeAssetDetails(aPolicy, aToken, newAAmount),
    encodeAssetDetails(bPolicy, bToken, newBAmount),
    parsed.fields[5], // price
    parsed.fields[6], // start
    parsed.fields[7], // end
    parsed.fields[8], // takerFlat
    parsed.fields[9], // takerRatio
    parsed.fields[10], // makerRatio
    parsed.fields[11], // freshness
  ]);

  // 7. Continuing output assets
  const continuingAssets: Assets = {};
  let contLovelace = minDeposit;
  if (isAda(aPolicy)) {
    contLovelace += newAAmount;
  } else if (newAAmount > 0n) {
    continuingAssets[unitOf(aPolicy, aToken)] = newAAmount;
  }

  if (isAda(bPolicy)) {
    contLovelace += newBAmount;
  } else if (newBAmount > 0n) {
    continuingAssets[unitOf(bPolicy, bToken)] = newBAmount;
  }
  continuingAssets["lovelace"] = contLovelace;
  continuingAssets[nftUnit] = 1n;

  // 8. Protocol fee assets
  const feeAssets: Assets = {
    lovelace: takerFlatFee,
  };
  // Taker fee is paid in payment asset
  if (takerFeePayment > 0n) {
    if (paymentAssetUnit === "lovelace") {
      feeAssets.lovelace = (feeAssets.lovelace || 0n) + takerFeePayment;
    } else {
      feeAssets[paymentAssetUnit] = (feeAssets[paymentAssetUnit] || 0n) + takerFeePayment;
    }
  }
  // Maker fee is paid in offered asset
  if (makerFeeOffer > 0n) {
    if (offerAssetUnit === "lovelace") {
      feeAssets.lovelace = (feeAssets.lovelace || 0n) + makerFeeOffer;
    } else {
      feeAssets[offerAssetUnit] = (feeAssets[offerAssetUnit] || 0n) + makerFeeOffer;
    }
  }

  // Ensure fee output meets Cardano min-UTxO requirement if it contains custom assets
  if (
    Object.keys(feeAssets).some((k) => k !== "lovelace") &&
    feeAssets.lovelace < 1_300_000n
  ) {
    feeAssets.lovelace = 1_300_000n;
  }

  // 9. Taker payout
  const takerRecipient = params.recipientAddress ?? (await lucid.wallet().address());
  const takerAssets: Assets = {
    [offerAssetUnit]: offerNet,
  };

  // 10. Withdrawal redeemer
  let fillStakeRedeemer: string;
  if (priceField.index === 0) {
    fillStakeRedeemer = Data.to(new Constr(0, [[]]));
  } else {
    const cert = params.oracleCertificate!;
    const ptConstr = buildPriceTimestampConstr(
      cert.baseAsset.policyHex,
      cert.baseAsset.tokenHex,
      cert.quoteAsset.policyHex,
      cert.quoteAsset.tokenHex,
      cert.price.numerator,
      cert.price.denominator,
      cert.timestampMs
    );
    const fillDetails = new Constr(0, [cert.signatureHex, ptConstr]);
    const tuple = [nftTokenName, fillDetails];
    fillStakeRedeemer = Data.to(new Constr(0, [[tuple]]));
  }

  const fillStakeAddr = constants.slvFillStakeAddr;
  if (!fillStakeAddr) {
    throw new Error("slvFillStakeAddr is not configured.");
  }

  // 11. Assemble transaction
  let tx = lucid
    .newTx()
    .readFrom([configUtxo, spendRefUtxo, fillRefUtxo])
    .collectFrom([vaultUtxo], Data.to(new Constr(1, []))) // OrderRedeemer::FillOrder
    .withdraw(fillStakeAddr, 0n, fillStakeRedeemer)
    .pay.ToAddressWithData(
      constants.slvAddr,
      {
        kind: "inline",
        value: Data.to(updatedDatum),
      },
      continuingAssets
    )
    .pay.ToAddressWithData(
      feeAddr,
      {
        kind: "inline",
        value: Data.to(constants.slvNftPolicyId),
      },
      feeAssets
    )
    .pay.ToAddress(takerRecipient, takerAssets);

  if (params.oracleCertificate) {
    const validToMs =
      Number(params.oracleCertificate.timestampMs) +
      Number(freshnessSeconds) * 1000 -
      5000;
    tx = tx.validTo(validToMs).validFrom(Date.now() - 30_000);
  }

  const completedTx = await tx.complete({ localUPLCEval: false });
  const signedTx = await completedTx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  return txHash;
}

