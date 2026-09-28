import { LucidEvolution, UTxO, Data, Constr, getAddressDetails } from "@lucid-evolution/lucid";
import { NetworkType, FetchProgress } from "../types";
import { DEX_CONSTANTS } from "../config/dex";
import { getOrFetchDatum, getOrFetchTx } from "./cache";

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
 * Concurrency runner for processing multiple items without exceeding rate limits.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (current: number, total: number) => void,
  shouldAbort?: () => boolean
): Promise<R[]> {
  const results: R[] = [];
  let currentIndex = 0;
  let completedCount = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (currentIndex < items.length) {
      if (shouldAbort && shouldAbort()) break;
      const idx = currentIndex++;
      try {
        const res = await fn(items[idx], idx);
        results[idx] = res;
      } catch (err) {
        // Handled in caller's fn
      }
      completedCount++;
      onProgress?.(completedCount, items.length);
    }
  });

  await Promise.all(workers);
  return results.filter((r) => r !== undefined);
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
      let datumHex = utxo.datum;
      if (!datumHex && utxo.datumHash) {
        datumHex = await getOrFetchDatum(utxo.datumHash, async () => {
          return await lucid.config().provider.getDatum(utxo.datumHash!);
        });
      }

      if (datumHex) {
        rawDatumHex = datumHex;
        const datum = Data.from(datumHex) as any;
        if (datum && typeof datum === "object" && "fields" in datum && Array.isArray(datum.fields)) {
          ownerPkh = String(datum.fields[0]).toLowerCase();

          const lockField = datum.fields[2];
          if (lockField && typeof lockField === "object" && "index" in lockField && lockField.index === 0) {
            const timeVal = lockField.fields?.[0];
            if (timeVal !== undefined) {
              lockedUntilMs = Number(timeVal);
            }
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
 * Fast parallel batch fetch of all UTxOs at an address from Blockfrost.
 * 3,600 UTxOs take only ~1.5s total across 37 requests.
 */
export async function fetchAllAddressUtxos(
  blockfrostUrl: string,
  blockfrostApiKey: string,
  address: string,
  onProgress?: (progress: FetchProgress) => void,
  abortSignal?: { aborted: boolean }
): Promise<any[]> {
  const allUtxos: any[] = [];
  const countPerPage = 100;
  let page = 1;
  const batchSize = 5; // 5 parallel requests = 500 UTxOs per batch

  while (true) {
    if (abortSignal?.aborted) break;

    const pageNumbers: number[] = [];
    for (let i = 0; i < batchSize; i++) {
      pageNumbers.push(page + i);
    }

    try {
      const pagePromises = pageNumbers.map((p) =>
        fetch(`${blockfrostUrl}/addresses/${address}/utxos?count=${countPerPage}&page=${p}`, {
          headers: { project_id: blockfrostApiKey },
        }).then(async (res) => {
          if (!res.ok) return [];
          return (await res.json()) as any[];
        })
      );

      const batchResults = await Promise.all(pagePromises);

      let foundEnd = false;
      for (const results of batchResults) {
        if (!Array.isArray(results) || results.length === 0) {
          foundEnd = true;
          break;
        }
        allUtxos.push(...results);
        if (results.length < countPerPage) {
          foundEnd = true;
          break;
        }
      }

      onProgress?.({
        current: allUtxos.length,
        total: Math.max(allUtxos.length, 3600),
        stage: `Discovered ${allUtxos.length.toLocaleString()} on-chain vaults...`,
        itemType: "Vaults",
      });

      if (foundEnd || abortSignal?.aborted) {
        break;
      }

      page += batchSize;
    } catch (err) {
      console.warn("Error fetching batch pages for address:", address, err);
      break;
    }
  }

  return allUtxos;
}

/**
 * Parses raw Blockfrost UTxO JSON into a StakingVault model in memory in ~1 microsecond.
 * No network calls required for basic fields (project, amounts, utxoRef).
 */
export function parseRawBlockfrostUtxo(
  raw: any,
  constants: typeof DEX_CONSTANTS["mainnet"],
  network: NetworkType,
  isUserOwned: boolean
): StakingVault {
  const amountList: { unit: string; quantity: string }[] = raw.amount || [];
  const nonAda = amountList.filter((a) => a.unit !== "lovelace");
  const primary =
    nonAda.length > 0
      ? nonAda[0]
      : amountList.find((a) => a.unit === "lovelace") || { unit: "lovelace", quantity: "0" };

  const stakedTokenUnit = primary.unit;
  const stakedAmount = BigInt(primary.quantity || "0");

  const adaItem = amountList.find((a) => a.unit === "lovelace");
  const depositLovelace = adaItem ? BigInt(adaItem.quantity || "0") : 0n;

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
  let rawDatumHex: string | undefined = raw.inline_datum || undefined;

  if (raw.inline_datum) {
    try {
      const datum = Data.from(raw.inline_datum) as any;
      if (datum && typeof datum === "object" && "fields" in datum && Array.isArray(datum.fields)) {
        ownerPkh = String(datum.fields[0]).toLowerCase();
        const lockField = datum.fields[2];
        if (lockField && typeof lockField === "object" && "index" in lockField && lockField.index === 0) {
          const timeVal = lockField.fields?.[0];
          if (timeVal !== undefined) {
            lockedUntilMs = Number(timeVal);
          }
        }
      }
    } catch {}
  }

  const isUnlocked = !lockedUntilMs || Date.now() >= lockedUntilMs;

  return {
    utxoRef: {
      txHash: raw.tx_hash,
      outputIndex: raw.output_index,
    },
    ownerPkh,
    project,
    stakedTokenUnit,
    stakedAmount,
    depositLovelace,
    lockedUntilMs,
    isUnlocked,
    isUserOwned,
    rawDatumHex,
  };
}

/**
 * Queries all on-chain staking vaults and identifies those belonging to the user.
 * 
 * - Discovers ALL on-chain vaults (3,600+) in ~1.5s via parallel batching.
 * - Extracts project and amounts immediately with 0 extra datum requests.
 * - Accurately matches user's vaults via wallet address history and PKHs.
 * - Automatically resolves and caches datums for the user's vaults for 1-click unstaking.
 */
export async function fetchUserStakingVaults(
  lucid: LucidEvolution,
  network: NetworkType,
  walletTokenUnits: string[],
  userPkhs: string[] = [],
  userAddresses: string[] = [],
  blockfrostApiKey?: string,
  onProgress?: (progress: FetchProgress) => void,
  options?: {
    forceFullScan?: boolean;
    abortSignal?: { aborted: boolean };
  }
): Promise<StakingVault[]> {
  const constants = DEX_CONSTANTS[network];
  const stakingAddr = constants.stakingAddr;
  const vaults: StakingVault[] = [];
  const processedOutRefs = new Set<string>();
  const normalizedUserPkhs = new Set(userPkhs.map((p) => p.toLowerCase()));

  // 1. FAST PATH: Find user-owned candidate UTxO references from wallet history
  const userCandidateRefs = new Set<string>();
  if (blockfrostApiKey && userAddresses.length > 0) {
    const scanAddrs = userAddresses.slice(0, 10);
    const checkedTxHashes = new Set<string>();

    onProgress?.({
      current: 0,
      total: scanAddrs.length,
      stage: `Checking wallet history (${scanAddrs.length} addresses)...`,
      itemType: "Addresses",
    });

    for (let i = 0; i < scanAddrs.length; i++) {
      if (options?.abortSignal?.aborted) break;
      const addr = scanAddrs[i];

      try {
        const txsResp = await fetch(
          `${constants.blockfrostUrl}/addresses/${addr}/transactions?count=50&order=desc`,
          { headers: { project_id: blockfrostApiKey } }
        );
        if (!txsResp.ok) continue;
        const txs: { tx_hash: string }[] = await txsResp.json();

        for (const tx of txs) {
          if (options?.abortSignal?.aborted) break;
          if (checkedTxHashes.has(tx.tx_hash)) continue;
          checkedTxHashes.add(tx.tx_hash);

          try {
            const utxoData = await getOrFetchTx(tx.tx_hash, async () => {
              const res = await fetch(
                `${constants.blockfrostUrl}/txs/${tx.tx_hash}/utxos`,
                { headers: { project_id: blockfrostApiKey } }
              );
              if (!res.ok) return null;
              return await res.json();
            });

            if (utxoData && utxoData.outputs) {
              for (const out of utxoData.outputs) {
                if (out.address === stakingAddr) {
                  userCandidateRefs.add(`${tx.tx_hash}#${out.output_index}`);
                }
              }
            }
          } catch {}
        }
      } catch (err) {
        console.warn("Wallet scan error for address:", addr, err);
      }
    }
  }

  // 2. DISCOVER ALL ON-CHAIN VAULTS AT STAKING SCRIPT
  let rawUtxos: any[] = [];
  if (blockfrostApiKey) {
    rawUtxos = await fetchAllAddressUtxos(
      constants.blockfrostUrl,
      blockfrostApiKey,
      stakingAddr,
      onProgress,
      options?.abortSignal
    );

    for (const raw of rawUtxos) {
      const refKey = `${raw.tx_hash}#${raw.output_index}`;
      if (processedOutRefs.has(refKey)) continue;
      processedOutRefs.add(refKey);

      const isCandidate = userCandidateRefs.has(refKey);
      const vault = parseRawBlockfrostUtxo(raw, constants, network, isCandidate);

      if (vault.ownerPkh && normalizedUserPkhs.has(vault.ownerPkh)) {
        vault.isUserOwned = true;
      }

      vaults.push(vault);
    }

    // 3. For any user-owned vaults, resolve datum hash if not already inline
    const userVaultsToResolve = vaults.filter((v) => v.isUserOwned && !v.rawDatumHex);
    if (userVaultsToResolve.length > 0) {
      onProgress?.({
        current: 0,
        total: userVaultsToResolve.length,
        stage: `Resolving details for ${userVaultsToResolve.length} of your vaults...`,
        itemType: "Vaults",
      });

      for (let i = 0; i < userVaultsToResolve.length; i++) {
        if (options?.abortSignal?.aborted) break;
        const uv = userVaultsToResolve[i];
        const matchRaw = rawUtxos.find(
          (r: any) => r.tx_hash === uv.utxoRef.txHash && r.output_index === uv.utxoRef.outputIndex
        );

        if (matchRaw && matchRaw.data_hash) {
          try {
            const datumHex = await getOrFetchDatum(matchRaw.data_hash, async () => {
              return await lucid.config().provider.getDatum(matchRaw.data_hash);
            });

            if (datumHex) {
              uv.rawDatumHex = datumHex;
              try {
                const datum = Data.from(datumHex) as any;
                if (datum?.fields && Array.isArray(datum.fields)) {
                  uv.ownerPkh = String(datum.fields[0]).toLowerCase();
                  const lockField = datum.fields[2];
                  if (lockField?.index === 0 && lockField.fields?.[0] !== undefined) {
                    uv.lockedUntilMs = Number(lockField.fields[0]);
                    uv.isUnlocked = Date.now() >= uv.lockedUntilMs;
                  }
                }
              } catch {}
            }
          } catch (err) {
            console.warn("Failed to resolve user vault datum:", uv.utxoRef, err);
          }
        }
      }
    }
  } else {
    // Fallback: Direct Lucid provider scan if direct Blockfrost URL/key not passed
    try {
      const scriptUtxos = await lucid.utxosAt(stakingAddr);
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
      console.warn("Direct script scan error:", err);
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
