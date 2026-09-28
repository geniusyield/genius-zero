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
 * Queries on-chain staking vaults and identifies those belonging to the user.
 * Supports multi-address inspection across all wallet credentials (pkhs).
 */
export async function fetchUserStakingVaults(
  lucid: LucidEvolution,
  network: NetworkType,
  walletTokenUnits: string[],
  userPkhs: string[] = []
): Promise<StakingVault[]> {
  const constants = DEX_CONSTANTS[network];
  const stakingAddr = constants.stakingAddr;

  let scriptUtxos: UTxO[] = [];
  try {
    scriptUtxos = await lucid.utxosAt(stakingAddr);
  } catch (err) {
    console.error("Failed to query staking address UTxOs:", err);
    return [];
  }

  const vaults: StakingVault[] = [];
  const normalizedUserPkhs = new Set(userPkhs.map((p) => p.toLowerCase()));

  for (const utxo of scriptUtxos) {
    try {
      // Find non-ADA staked tokens
      const nonAdaAssets = Object.entries(utxo.assets).filter(([unit]) => unit !== "lovelace");
      const primaryAsset: [string, bigint] =
        nonAdaAssets.length > 0
          ? [nonAdaAssets[0][0], nonAdaAssets[0][1]]
          : ["lovelace", utxo.assets.lovelace];
      const stakedTokenUnit = primaryAsset[0];
      const stakedAmount = primaryAsset[1];

      // Determine project label
      let project = "Custom";
      if (stakedTokenUnit.includes("47454e5358") || stakedTokenUnit.startsWith(constants.gensxVaultNftPolicy)) {
        project = "GENSX";
      } else if (stakedTokenUnit.includes("47454e53") || stakedTokenUnit.startsWith(constants.gensVaultNftPolicy)) {
        project = network === "mainnet" ? "GENS" : "tGENS";
      } else if (stakedTokenUnit === "lovelace") {
        project = network === "mainnet" ? "ADA" : "tADA";
      }

      // Resolve datum to inspect owner key and lock time
      let ownerPkh = "";
      let lockedUntilMs: number | undefined;
      let rawDatumHex: string | undefined;

      try {
        const datum = (await lucid.datumOf(utxo)) as any;
        if (datum && typeof datum === "object" && "fields" in datum && Array.isArray(datum.fields)) {
          rawDatumHex = Data.to(datum);
          ownerPkh = String(datum.fields[0]).toLowerCase();

          // Check lockedUntil (field 2)
          const lockField = datum.fields[2];
          if (lockField && typeof lockField === "object" && "index" in lockField && lockField.index === 0) {
            const timeVal = lockField.fields?.[0];
            if (timeVal !== undefined) {
              lockedUntilMs = Number(timeVal);
            }
          }
        }
      } catch (datumErr) {
        // If datum cannot be resolved directly, continue with fallback
      }

      const isUserOwned = ownerPkh ? normalizedUserPkhs.has(ownerPkh) : false;
      const isUnlocked = !lockedUntilMs || Date.now() >= lockedUntilMs;

      vaults.push({
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
      });
    } catch (err) {
      console.warn("Failed to parse staking UTxO:", utxo.txHash, err);
    }
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
