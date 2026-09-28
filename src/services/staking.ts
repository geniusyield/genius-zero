import { LucidEvolution, UTxO, Data, Constr, getAddressDetails } from "@lucid-evolution/lucid";
import { NetworkType } from "../types";
import { DEX_CONSTANTS } from "../config/dex";

// Pinned PlutusV1 Staking Validator Script from Genius Yield Core
export const STAKING_VALIDATOR = {
  type: "PlutusV1" as const,
  script:
    "5901bf5901bc0100003232323232323232323232322223232323232323253330123015300f0021533301200314985854ccc04800c4c8c94ccc0514ccc050cc034c058008c0580044cc034c058c04c004c058c04c0085280a4c2c60286ea8c054c044c050dd500418099baa30163300e30163300e3374a9001198071ba8375a602800297ae03300e300d4a297ae03300e30163300e3374a900225eb80cc038c03528a5eb812f5c02c60240026ea8c048c03cc03cc044dd5004198011198010010009bac3011300e300d301037540084600446600400400244a666aae7c0045280a99980799baf301100100314a226004601c0026ea4dd7180718069baa004300d300c3754002446464646464646464a666022a66602266e200080045288a99980899b8700200113232533301330160041337106eb4c054008dd6980a8008a503013004301200414a0294454ccc044cdd78030028999808980598099808004180598099808003a5114a0601a00460180046ea8008dd50011807001180680118059baa002300a37540044601460086ea80048cdd2999803000a4004900025eb815d02ab9d23002300230023002300230020015744ae6955cf2ba1370e90011ba5480001",
};

export interface StakingVault {
  utxoRef: {
    txHash: string;
    outputIndex: number;
  };
  ownerPkh: string;
  project: string; // "GENS" | "GENSX" | "tGENS" | other
  stakedTokenUnit: string;
  stakedAmount: bigint;
  depositLovelace: bigint;
  lockedUntilMs?: number;
  isUnlocked: boolean;
  isUserOwned: boolean;
  rawDatumHex?: string;
}

/**
 * Constructs a Plutus-compliant StakeDatum for Genius Yield staking script.
 */
export function makeStakeDatum(ownerPkh: string, lockUntilMs?: number | null): Constr<any> {
  const ownerKey = ownerPkh;
  const ownerAddr = new Constr(0, [
    new Constr(0, [ownerPkh]),
    new Constr(1, []), // Enterprise address (no staking credential)
  ]);
  const lockedUntil = lockUntilMs
    ? new Constr(0, [BigInt(lockUntilMs)])
    : new Constr(1, []); // Constr 1 = Nothing

  return new Constr(0, [ownerKey, ownerAddr, lockedUntil]);
}

/**
 * Parses a single staking UTxO into a StakingVault model.
 */
async function parseStakingUtxo(
  lucid: LucidEvolution,
  utxo: UTxO,
  constants: typeof DEX_CONSTANTS["mainnet"],
  network: NetworkType,
  isUserOwned: boolean
): Promise<StakingVault | null> {
  try {
    const nonAdaAssets = Object.entries(utxo.assets).filter(([unit]) => unit !== "lovelace");
    const primaryAsset: [string, bigint] =
      nonAdaAssets.length > 0
        ? [nonAdaAssets[0][0], nonAdaAssets[0][1]]
        : ["lovelace", utxo.assets.lovelace];
    const stakedTokenUnit = primaryAsset[0];
    const stakedAmount = primaryAsset[1];

    let project = "Custom";
    if (stakedTokenUnit.includes("47454e5358") || stakedTokenUnit.startsWith(constants.gensxVaultNftPolicy)) {
      project = "GENSX";
    } else if (stakedTokenUnit.includes("47454e53") || stakedTokenUnit.startsWith(constants.gensVaultNftPolicy)) {
      project = network === "mainnet" ? "GENS" : "tGENS";
    } else if (stakedTokenUnit === "lovelace") {
      project = network === "mainnet" ? "ADA" : "tADA";
    }

    let ownerPkh = "";
    let lockedUntilMs: number | undefined;
    let rawDatumHex: string | undefined;

    try {
      const datum = (await lucid.datumOf(utxo)) as any;
      if (datum && typeof datum === "object" && "fields" in datum && Array.isArray(datum.fields)) {
        rawDatumHex = Data.to(datum);
        ownerPkh = String(datum.fields[0]).toLowerCase();

        const lockField = datum.fields[2];
        if (lockField && typeof lockField === "object" && "index" in lockField && lockField.index === 0) {
          const timeVal = lockField.fields?.[0];
          if (timeVal !== undefined) {
            lockedUntilMs = Number(timeVal);
          }
        }
      }
    } catch {
      // Datum resolution fallback
    }

    const isUnlocked = !lockedUntilMs || Date.now() >= lockedUntilMs;

    return {
      utxoRef: {
        txHash: utxo.txHash,
        outputIndex: utxo.outputIndex,
      },
      ownerPkh,
      project,
      stakedTokenUnit,
      stakedAmount,
      depositLovelace: utxo.assets.lovelace,
      lockedUntilMs,
      isUnlocked,
      isUserOwned,
      rawDatumHex,
    };
  } catch {
    return null;
  }
}

/**
 * Queries on-chain staking vaults and identifies those belonging to the user.
 * 
 * Blazing fast: Discovers the user's vaults in milliseconds from wallet transaction
 * history rather than sequentially parsing 3,600+ on-chain datums.
 */
export async function fetchUserStakingVaults(
  lucid: LucidEvolution,
  network: NetworkType,
  walletTokenUnits: string[],
  userPkhs: string[] = [],
  userAddresses: string[] = [],
  blockfrostApiKey?: string
): Promise<StakingVault[]> {
  const constants = DEX_CONSTANTS[network];
  const stakingAddr = constants.stakingAddr;
  const vaults: StakingVault[] = [];
  const processedOutRefs = new Set<string>();

  // 1. FAST PATH: Find user-owned vaults from wallet transaction history
  if (blockfrostApiKey && userAddresses.length > 0) {
    const candidateRefs: { txHash: string; outputIndex: number }[] = [];
    const checkedTxHashes = new Set<string>();

    // Scan up to 10 user addresses from the wallet
    const scanAddrs = userAddresses.slice(0, 10);
    for (const addr of scanAddrs) {
      try {
        const txsResp = await fetch(
          `${constants.blockfrostUrl}/addresses/${addr}/transactions?count=50&order=desc`,
          { headers: { project_id: blockfrostApiKey } }
        );
        if (!txsResp.ok) continue;
        const txs: { tx_hash: string }[] = await txsResp.json();

        for (const tx of txs) {
          if (checkedTxHashes.has(tx.tx_hash)) continue;
          checkedTxHashes.add(tx.tx_hash);

          try {
            const utxoResp = await fetch(
              `${constants.blockfrostUrl}/txs/${tx.tx_hash}/utxos`,
              { headers: { project_id: blockfrostApiKey } }
            );
            if (!utxoResp.ok) continue;
            const utxoData: { outputs: { address: string; output_index: number }[] } =
              await utxoResp.json();

            for (const out of utxoData.outputs) {
              if (out.address === stakingAddr) {
                candidateRefs.push({
                  txHash: tx.tx_hash,
                  outputIndex: out.output_index,
                });
              }
            }
          } catch {}
        }
      } catch (err) {
        console.warn("Wallet transaction scan error for address:", addr, err);
      }
    }

    // Query only the candidate UTxOs to see if they are currently unspent
    if (candidateRefs.length > 0) {
      try {
        const liveUserUtxos = await lucid.utxosByOutRef(candidateRefs);
        for (const u of liveUserUtxos) {
          const refKey = `${u.txHash}#${u.outputIndex}`;
          if (processedOutRefs.has(refKey)) continue;
          processedOutRefs.add(refKey);

          const vault = await parseStakingUtxo(lucid, u, constants, network, true);
          if (vault) vaults.push(vault);
        }
      } catch (err) {
        console.warn("Candidate UTxO lookup error:", err);
      }
    }
  }

  // 2. PREPROD TESTNET FALLBACK: On Preprod (few UTxOs), scan directly
  if (network === "preprod" && vaults.length === 0) {
    try {
      const scriptUtxos = await lucid.utxosAt(stakingAddr);
      const normalizedUserPkhs = new Set(userPkhs.map((p) => p.toLowerCase()));

      for (const u of scriptUtxos) {
        const refKey = `${u.txHash}#${u.outputIndex}`;
        if (processedOutRefs.has(refKey)) continue;
        processedOutRefs.add(refKey);

        const vault = await parseStakingUtxo(lucid, u, constants, network, false);
        if (vault) {
          if (vault.ownerPkh && normalizedUserPkhs.has(vault.ownerPkh)) {
            vault.isUserOwned = true;
          }
          vaults.push(vault);
        }
      }
    } catch (err) {
      console.warn("Preprod direct script scan error:", err);
    }
  }

  // 3. COMMUNITY PREVIEW (Top 10): Fetch a small sample of active on-chain vaults
  if (blockfrostApiKey && vaults.length < 15) {
    try {
      const commResp = await fetch(
        `${constants.blockfrostUrl}/addresses/${stakingAddr}/utxos?count=10&page=1`,
        { headers: { project_id: blockfrostApiKey } }
      );
      if (commResp.ok) {
        const commData: {
          tx_hash: string;
          output_index: number;
          amount: { unit: string; quantity: string }[];
        }[] = await commResp.json();

        const commRefs = commData
          .map((d) => ({ txHash: d.tx_hash, outputIndex: d.output_index }))
          .filter((ref) => !processedOutRefs.has(`${ref.txHash}#${ref.outputIndex}`));

        if (commRefs.length > 0) {
          const commUtxos = await lucid.utxosByOutRef(commRefs);
          for (const u of commUtxos) {
            const refKey = `${u.txHash}#${u.outputIndex}`;
            if (processedOutRefs.has(refKey)) continue;
            processedOutRefs.add(refKey);

            const vault = await parseStakingUtxo(lucid, u, constants, network, false);
            if (vault) vaults.push(vault);
          }
        }
      }
    } catch {}
  }

  // Sort user's owned vaults first, then by staked amount descending
  vaults.sort((a, b) => {
    if (a.isUserOwned && !b.isUserOwned) return -1;
    if (!a.isUserOwned && b.isUserOwned) return 1;
    return Number(b.stakedAmount - a.stakedAmount);
  });

  return vaults;
}

/**
 * Builds and submits the on-chain unstake transaction.
 * Correctly adds `sdOwnerKey` witness requirement so multi-address wallets
 * (like Eternl) can sign on behalf of the original staking derivation index.
 */
export async function unstakeVault(
  lucid: LucidEvolution,
  vault: StakingVault
): Promise<string> {
  // Query exact UTxO from chain
  const [utxo] = await lucid.utxosByOutRef([
    {
      txHash: vault.utxoRef.txHash,
      outputIndex: vault.utxoRef.outputIndex,
    },
  ]);

  if (!utxo) {
    throw new Error(`Vault UTxO ${vault.utxoRef.txHash}#${vault.utxoRef.outputIndex} not found on chain.`);
  }

  // Resolve datum
  const rawDatum = await lucid.datumOf(utxo);
  const utxoWithDatum: UTxO = {
    ...utxo,
    datum: Data.to(rawDatum),
  };

  const ownerPkh = vault.ownerPkh || String((rawDatum as any).fields?.[0] || "");

  // Build unstaking transaction
  let tx = lucid
    .newTx()
    .collectFrom([utxoWithDatum], Data.void()) // Redeemer is () (unit)
    .attach.SpendingValidator(STAKING_VALIDATOR)
    .addSignerKey(ownerPkh); // Enforces signature from original staking address PKH

  // If locked, ensure tx validity range starts at or after the unlock time
  if (vault.lockedUntilMs && vault.lockedUntilMs > Date.now()) {
    throw new Error(`Vault is locked until ${new Date(vault.lockedUntilMs).toLocaleString()}. Unstaking is not yet permitted.`);
  } else if (vault.lockedUntilMs) {
    tx = tx.validFrom(Math.max(Date.now() - 60_000, vault.lockedUntilMs));
  }

  const completedTx = await tx.complete();
  const signedTx = await completedTx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  return txHash;
}

/**
 * Allows creating a test staking vault on Preprod (or Mainnet) directly from the UI.
 * Ideal for replicating and testing the multi-address unstaking flow on testnet.
 */
export async function createStake(
  lucid: LucidEvolution,
  network: NetworkType,
  ownerAddress: string,
  stakedAmountLovelace: bigint,
  stakedTokenUnit?: string,
  stakedTokenAmount?: bigint,
  lockDurationDays: number = 0
): Promise<string> {
  const constants = DEX_CONSTANTS[network];
  const addrDetails = getAddressDetails(ownerAddress);
  const ownerPkh = addrDetails.paymentCredential?.hash;

  if (!ownerPkh) {
    throw new Error("Unable to derive payment credential from wallet address.");
  }

  const lockUntilMs = lockDurationDays > 0 ? Date.now() + lockDurationDays * 86_400_000 : null;
  const datum = makeStakeDatum(ownerPkh, lockUntilMs);
  const datumHex = Data.to(datum);

  const assets: Record<string, bigint> = {
    lovelace: stakedAmountLovelace,
  };

  if (stakedTokenUnit && stakedTokenAmount && stakedTokenAmount > 0n) {
    assets[stakedTokenUnit] = stakedTokenAmount;
  }

  const tx = await lucid
    .newTx()
    .pay.ToContract(constants.stakingAddr, { kind: "inline", value: datumHex }, assets)
    .complete();

  const signedTx = await tx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  return txHash;
}
