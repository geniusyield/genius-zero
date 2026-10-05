import {
  LucidEvolution,
  UTxO,
  Data,
  Constr,
  getAddressDetails,
  credentialToRewardAddress,
} from "@lucid-evolution/lucid";
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
      const timestamp = Date.now();
      const pagePromises = pageNumbers.map((p) =>
        fetch(`${blockfrostUrl}/addresses/${address}/utxos?count=${countPerPage}&page=${p}&_t=${timestamp}`, {
          headers: { project_id: blockfrostApiKey },
          cache: "no-store",
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
    rewardAddress?: string | null;
    spentRefs?: Set<string>;
  }
): Promise<StakingVault[]> {
  const constants = DEX_CONSTANTS[network];
  const stakingAddr = constants.stakingAddr;
  const vaults: StakingVault[] = [];
  const processedOutRefs = new Set<string>();
  const normalizedUserPkhs = new Set(userPkhs.map((p) => p.toLowerCase()));

  // 1. DISCOVER ALL ON-CHAIN VAULTS AT STAKING SCRIPT FIRST
  let rawUtxos: any[] = [];
  const userCandidateRefs = new Set<string>();
  const rawUtxoByRef = new Map<string, any>();
  const rawUtxosByTxHash = new Map<string, any[]>();
  const scriptTxHashes = new Set<string>();

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
      if (options?.spentRefs?.has(refKey)) continue;
      scriptTxHashes.add(raw.tx_hash);
      rawUtxoByRef.set(refKey, raw);
      const list = rawUtxosByTxHash.get(raw.tx_hash) || [];
      list.push(raw);
      rawUtxosByTxHash.set(raw.tx_hash, list);
    }

    // 2. DISCOVER USER-OWNED VAULTS FROM WALLET TRANSACTION HISTORY
    const addressesToScan: string[] = [];
    const seenAddrs = new Set<string>();
    for (const addr of userAddresses) {
      if (addr && !seenAddrs.has(addr)) {
        seenAddrs.add(addr);
        addressesToScan.push(addr);
      }
    }

    // Discover all addresses and payment credentials under the wallet's stake account (Eternl multi-address support)
    let stakeAddress = options?.rewardAddress;
    if (!stakeAddress && addressesToScan.length > 0) {
      try {
        const details = getAddressDetails(addressesToScan[0]);
        if (details.stakeCredential) {
          const net = network === "mainnet" ? "Mainnet" : "Preprod";
          stakeAddress = credentialToRewardAddress(net, details.stakeCredential);
        }
      } catch {}
    }

    if (stakeAddress) {
      try {
        const accResp = await fetch(
          `${constants.blockfrostUrl}/accounts/${stakeAddress}/addresses?count=100&_t=${Date.now()}`,
          {
            headers: { project_id: blockfrostApiKey },
            cache: "no-store",
          }
        );
        if (accResp.ok) {
          const accAddrs: { address: string }[] = await accResp.json();
          if (Array.isArray(accAddrs)) {
            for (const item of accAddrs) {
              if (item.address) {
                if (!seenAddrs.has(item.address)) {
                  seenAddrs.add(item.address);
                  addressesToScan.push(item.address);
                }
                try {
                  const details = getAddressDetails(item.address);
                  if (details.paymentCredential?.hash) {
                    normalizedUserPkhs.add(details.paymentCredential.hash.toLowerCase());
                  }
                } catch {}
              }
            }
          }
        }
      } catch (err) {
        console.warn("Could not query account addresses from Blockfrost:", err);
      }
    }

    if (addressesToScan.length > 0) {
      onProgress?.({
        current: 0,
        total: addressesToScan.length,
        stage: `Scanning wallet history across ${addressesToScan.length} addresses...`,
        itemType: "Addresses",
      });

      // Primary address: deep scan (up to 30 pages = 3,000 transactions)
      // Secondary addresses: standard scan (up to 5 pages = 500 transactions each)
      for (let addrIdx = 0; addrIdx < addressesToScan.length; addrIdx++) {
        if (options?.abortSignal?.aborted) break;
        const addr = addressesToScan[addrIdx];
        const maxPages = addrIdx === 0 ? 30 : 5;
        const countPerPage = 100;
        const batchSize = 5;
        let page = 1;

        while (page <= maxPages) {
          if (options?.abortSignal?.aborted) break;
          const pageNumbers: number[] = [];
          for (let i = 0; i < batchSize && page + i <= maxPages; i++) {
            pageNumbers.push(page + i);
          }

          try {
            const pagePromises = pageNumbers.map((p) =>
              fetch(
                `${constants.blockfrostUrl}/addresses/${addr}/transactions?count=${countPerPage}&page=${p}&_t=${Date.now()}`,
                {
                  headers: { project_id: blockfrostApiKey },
                  cache: "no-store",
                }
              ).then(async (res) => {
                if (!res.ok) return [];
                return (await res.json()) as { tx_hash: string }[];
              })
            );

            const batchResults = await Promise.all(pagePromises);
            let reachedEnd = false;

            for (const txList of batchResults) {
              if (!Array.isArray(txList) || txList.length === 0) {
                reachedEnd = true;
                break;
              }

              for (const tx of txList) {
                if (scriptTxHashes.has(tx.tx_hash)) {
                  const matchingUtxos = rawUtxosByTxHash.get(tx.tx_hash) || [];
                  for (const m of matchingUtxos) {
                    userCandidateRefs.add(`${m.tx_hash}#${m.output_index}`);
                  }
                }
              }

              if (txList.length < countPerPage) {
                reachedEnd = true;
                break;
              }
            }

            if (userCandidateRefs.size > 0) {
              onProgress?.({
                current: userCandidateRefs.size,
                total: rawUtxos.length,
                stage: `Found ${userCandidateRefs.size} of your staking vaults...`,
                itemType: "Vaults",
              });
            }

            if (reachedEnd) break;
            page += batchSize;
          } catch (err) {
            console.warn("Error scanning transactions for address:", addr, err);
            break;
          }
        }
      }
    }

    // 3. PARSE ALL VAULTS
    for (const raw of rawUtxos) {
      const refKey = `${raw.tx_hash}#${raw.output_index}`;
      if (processedOutRefs.has(refKey)) continue;
      if (options?.spentRefs?.has(refKey)) continue;
      processedOutRefs.add(refKey);

      const isCandidate = userCandidateRefs.has(refKey);
      const vault = parseRawBlockfrostUtxo(raw, constants, network, isCandidate);

      if (vault.ownerPkh && normalizedUserPkhs.has(vault.ownerPkh)) {
        vault.isUserOwned = true;
      }

      vaults.push(vault);
    }

    // 4. RESOLVE CONTRACT DATUMS FOR USER-OWNED VAULTS
    const userVaultsToResolve = vaults.filter((v) => v.isUserOwned && !v.rawDatumHex);
    if (userVaultsToResolve.length > 0) {
      onProgress?.({
        current: 0,
        total: userVaultsToResolve.length,
        stage: `Resolving contract datums for ${userVaultsToResolve.length} of your vaults...`,
        itemType: "Vaults",
      });

      for (let i = 0; i < userVaultsToResolve.length; i++) {
        if (options?.abortSignal?.aborted) break;
        const uv = userVaultsToResolve[i];
        const matchRaw = rawUtxoByRef.get(`${uv.utxoRef.txHash}#${uv.utxoRef.outputIndex}`);

        if (matchRaw && matchRaw.data_hash) {
          try {
            const datumHex = await getOrFetchDatum(matchRaw.data_hash, async () => {
              // 1. Direct Blockfrost CBOR endpoint
              if (blockfrostApiKey) {
                try {
                  const resp = await fetch(
                    `${constants.blockfrostUrl}/scripts/datum/${matchRaw.data_hash}/cbor`,
                    { headers: { project_id: blockfrostApiKey } }
                  );
                  if (resp.ok) {
                    const data = await resp.json();
                    if (data?.cbor) return data.cbor;
                  }
                } catch {}
              }
              // 2. Fallback to Lucid provider
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
              } catch (e) {
                console.warn("Failed to parse datum CBOR:", e);
              }
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

  const activeVaults =
    options?.spentRefs && options.spentRefs.size > 0
      ? vaults.filter(
          (v) =>
            !options.spentRefs!.has(
              `${v.utxoRef.txHash}#${v.utxoRef.outputIndex}`
            )
        )
      : vaults;

  // Sort user's owned vaults first, then by staked amount descending
  activeVaults.sort((a, b) => {
    if (a.isUserOwned && !b.isUserOwned) return -1;
    if (!a.isUserOwned && b.isUserOwned) return 1;
    return Number(b.stakedAmount - a.stakedAmount);
  });

  return activeVaults;
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
  let datumHex = vault.rawDatumHex;
  if (!datumHex) {
    const rawDatum = await lucid.datumOf(utxo);
    datumHex = Data.to(rawDatum);
  }

  const utxoWithDatum: UTxO = {
    ...utxo,
    datum: datumHex,
  };

  let ownerPkh = vault.ownerPkh;
  if (!ownerPkh && datumHex) {
    try {
      const parsed = Data.from(datumHex) as any;
      ownerPkh = String(parsed?.fields?.[0] || "");
    } catch {}
  }

  // Build unstaking transaction
  let tx = lucid
    .newTx()
    .collectFrom([utxoWithDatum], Data.void()) // Redeemer is () (unit)
    .attach.SpendingValidator(STAKING_VALIDATOR);

  if (ownerPkh) {
    tx = tx.addSignerKey(ownerPkh); // Enforces signature from original staking address PKH
  }

  // If locked, ensure tx validity range starts at or after the unlock time
  if (vault.lockedUntilMs) {
    // In Cardano, validity interval lower bound translates to slot begin time.
    // The Plutus validator checks: contains (from lockedUntilMs) txInfoValidRange.
    // Therefore, the slot's begin time MUST be >= lockedUntilMs.
    const minValidFromMs = Math.ceil(vault.lockedUntilMs / 1000) * 1000;
    // Require 5s margin for blockchain node slot clock to catch up with client time
    if (Date.now() < minValidFromMs + 5_000) {
      const waitSec = Math.max(1, Math.ceil((minValidFromMs + 5_000 - Date.now()) / 1000));
      throw new Error(`Vault is unlocking. Please wait ${waitSec}s for on-chain block time to reach unlock slot.`);
    }
    tx = tx.validFrom(Math.max(Date.now() - 60_000, minValidFromMs));
  } else {
    tx = tx.validFrom(Date.now() - 60_000);
  }
  tx = tx.validTo(Date.now() + 900_000); // 15 minute validity window

  const completedTx = await tx.complete();
  const signedTx = await completedTx.sign.withWallet().complete();
  const cbor = signedTx.toCBOR();

  let txHash = "";
  try {
    // 1. Submit directly through Blockfrost provider (relayed straight to Cardano cardano-node)
    txHash = await lucid.config().provider.submitTx(cbor);
    console.log("Unstake tx successfully submitted via Blockfrost:", txHash);
  } catch (providerErr: any) {
    console.warn("Direct Blockfrost submission error, trying walletApi.submitTx:", providerErr);
    // 2. Fallback to wallet's internal submit
    txHash = await signedTx.submit();
    console.log("Unstake tx submitted via walletApi:", txHash);
  }

  // Also submit to wallet so wallet internal activity ledger records it
  try {
    await signedTx.submit();
  } catch {}

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

  const lockUntilMs = lockDurationDays > 0 ? Math.floor(Date.now() / 1000) * 1000 + lockDurationDays * 86_400_000 : null;
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
    .pay.ToContract(constants.stakingAddr, { kind: "asHash", value: datumHex }, assets)
    .complete();

  const signedTx = await tx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  return txHash;
}
