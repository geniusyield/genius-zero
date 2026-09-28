import { LucidEvolution, UTxO } from "@lucid-evolution/lucid";
import { NetworkType } from "../types";
import { DEX_CONSTANTS, DEFAULT_MAINNET_TOKENS } from "../config/dex";

export interface RewardPool {
  utxoRef: {
    txHash: string;
    outputIndex: number;
  };
  poolType: "Vault Staking" | "Accelerated Yield" | "Community Distribution";
  infoString: string;
  gistUrl?: string;
  availableLovelace: bigint;
  availableGens: bigint;
  userClaimableLovelace: bigint;
  userClaimableGens: bigint;
}

export async function fetchActiveRewardPools(
  lucid: LucidEvolution,
  network: NetworkType,
  userAddress?: string
): Promise<RewardPool[]> {
  const constants = DEX_CONSTANTS[network];
  const rewardsAddr = constants.rewardsAddr;
  const gensUnit = DEFAULT_MAINNET_TOKENS[1].unit;

  let scriptUtxos: UTxO[] = [];
  try {
    scriptUtxos = await lucid.utxosAt(rewardsAddr);
  } catch (err) {
    console.error("Failed to query rewards address UTxOs:", err);
    return [];
  }

  const pools: RewardPool[] = [];

  for (const utxo of scriptUtxos) {
    const lovelace = utxo.assets.lovelace || 0n;
    const gens = utxo.assets[gensUnit] || 0n;

    // Plutus datum or inline datum might contain info or Gist URL
    let datumStr = "";
    if (utxo.datum) {
      datumStr = utxo.datum;
    }

    // Determine pool type from UTxO content
    const poolType =
      gens > 0n && lovelace > 10_000_000n
        ? "Vault Staking"
        : "Accelerated Yield";

    pools.push({
      utxoRef: {
        txHash: utxo.txHash,
        outputIndex: utxo.outputIndex,
      },
      poolType,
      infoString: `Pool #${utxo.outputIndex} (${utxo.txHash.slice(0, 10)}...)`,
      availableLovelace: lovelace,
      availableGens: gens,
      userClaimableLovelace: 0n,
      userClaimableGens: 0n,
    });
  }

  return pools;
}
