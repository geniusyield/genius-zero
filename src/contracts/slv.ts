import {
  type Assets,
  type Credential,
  type LucidEvolution,
  type UTxO,
  Constr,
  Data,
  credentialToAddress,
  credentialToRewardAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { LiquidityVault, NetworkType } from "../types";
import { DEX_CONSTANTS, DexNetworkConstants } from "../config/dex";

/**
 * Decodes a Plutus-encoded Address into a Bech32 Cardano address.
 *
 * In Aiken/Plutus:
 * Address {
 *   payment_credential: Credential (0 = KeyHash, 1 = ScriptHash),
 *   stake_credential: Option<StakeCredential> (0 = Some(Inline(Cred)), 1 = None)
 * }
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
    // Inline credential is Constr 0
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

// In-memory cache for reference UTxOs
const slvRefUTxOsCache = new Map<
  string,
  {
    configUtxo: UTxO;
    mintRefUtxo: UTxO;
    spendRefUtxo: UTxO;
    cancelRefUtxo: UTxO;
  }
>();

/**
 * Fetches and caches the 4 required reference UTxOs for SLV operations:
 * 1. Config UTxO (holds two-way order global config datum & ref NFT)
 * 2. Mint reference script (mints & burns the order tracking NFT)
 * 3. Spend reference script (SLV validator at order script address)
 * 4. Cancel reference script (stake validator verifying ownership & burning)
 */
export async function fetchSlvRefUTxOs(
  lucid: LucidEvolution,
  constants: DexNetworkConstants
): Promise<{
  configUtxo: UTxO;
  mintRefUtxo: UTxO;
  spendRefUtxo: UTxO;
  cancelRefUtxo: UTxO;
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

  if (!configUtxo || !mintRefUtxo || !spendRefUtxo || !cancelRefUtxo) {
    throw new Error(
      `Failed to fetch all 4 SLV reference UTxOs on ${nid}: config=${!!configUtxo}, mint=${!!mintRefUtxo}, spend=${!!spendRefUtxo}, cancel=${!!cancelRefUtxo}`
    );
  }

  const result = {
    configUtxo,
    mintRefUtxo,
    spendRefUtxo,
    cancelRefUtxo,
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
