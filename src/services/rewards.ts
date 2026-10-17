import { getAddressDetails, LucidEvolution, UTxO, CML, fromHex } from "@lucid-evolution/lucid";
import { NetworkType } from "../types";
import { DEX_CONSTANTS, DEFAULT_MAINNET_TOKENS } from "../config/dex";

export interface RewardAsset {
  unit: string;
  ticker: string;
  amount: bigint;
  decimals: number;
}

export interface RewardPool {
  utxoRef: {
    txHash: string;
    outputIndex: number;
  };
  poolType: "Vault Staking" | "Accelerated Yield" | "Community Distribution";
  infoString: string;
  epochDate?: string;
  gistUrl?: string;
  availableLovelace: bigint;
  availableGens: bigint;
  availableGensX: bigint;
  availableAssets: RewardAsset[];
  userClaimableLovelace: bigint;
  userClaimableGens: bigint;
  userClaimableGensX: bigint;
  userClaimableTokens: RewardAsset[];
  userClaimed?: boolean;
  userClaimedLovelace?: bigint;
  userClaimedGens?: bigint;
  userClaimedGensX?: bigint;
  userClaimedTokens?: RewardAsset[];
}

export interface UserRewardsSummary {
  stakeKeyHash?: string;
  rewardAddress?: string;
  totalLovelace: bigint;
  totalGens: bigint;
  totalGensX: bigint;
  tokens: RewardAsset[];
  pools: RewardPool[];
}

export const KNOWN_REWARD_TOKENS: Record<string, { ticker: string; decimals: number }> = {
  "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb.0014df1047454e53": { ticker: "GENS", decimals: 6 },
  "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53": { ticker: "GENS", decimals: 6 },
  "fbae99b8679369079a7f6f0da14a2cf1c2d6bfd3afdf3a96a64ab67a.0014df1047454e5358": { ticker: "GENSX", decimals: 6 },
  "fbae99b8679369079a7f6f0da14a2cf1c2d6bfd3afdf3a96a64ab67a0014df1047454e5358": { ticker: "GENSX", decimals: 6 },
  "3b31e746a68c5bef72c0fb9f2185e6b1fad0ea2faaccfeeb275afe91.5245414348": { ticker: "REACH", decimals: 6 },
  "3b31e746a68c5bef72c0fb9f2185e6b1fad0ea2faaccfeeb275afe915245414348": { ticker: "REACH", decimals: 6 },
  "577f0b1342f8f8f4aed3388b80a8535812950c7a892495c0ecdf0f1e.0014df10464c4454": { ticker: "FLDT", decimals: 6 },
  "577f0b1342f8f8f4aed3388b80a8535812950c7a892495c0ecdf0f1e0014df10464c4454": { ticker: "FLDT", decimals: 6 },
  "fd5a192b76cb73f004edde3993c31f8846845d858fa29a19b8a19869.48594e": { ticker: "HYN", decimals: 6 },
  "fd5a192b76cb73f004edde3993c31f8846845d858fa29a19b8a1986948594e": { ticker: "HYN", decimals: 6 },
  "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d": { ticker: "USDM", decimals: 6 },
  "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d": { ticker: "USDM", decimals: 6 },
  "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f.534e454b": { ticker: "SNEK", decimals: 0 },
  "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b": { ticker: "SNEK", decimals: 0 },
  "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6.4d494e": { ticker: "MIN", decimals: 6 },
  "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e": { ticker: "MIN", decimals: 6 },
  "51a5e236c4de3af2b8020442e2a26f454fda3b04cb621c1294a0ef34.424f4f4b": { ticker: "BOOK", decimals: 6 },
  "51a5e236c4de3af2b8020442e2a26f454fda3b04cb621c1294a0ef34424f4f4b": { ticker: "BOOK", decimals: 6 },
  "533bb94a8850ee3ccbe483106489399112b74c905342cb1792a797a0.494e4459": { ticker: "INDY", decimals: 6 },
  "533bb94a8850ee3ccbe483106489399112b74c905342cb1792a797a0494e4459": { ticker: "INDY", decimals: 6 },
  "5d16cc1a177b5d9ba9cfa9793b07e60f1fb70fea1f8aef064415d114.494147": { ticker: "IAG", decimals: 6 },
  "5d16cc1a177b5d9ba9cfa9793b07e60f1fb70fea1f8aef064415d114494147": { ticker: "IAG", decimals: 6 },
  "5dac8536653edc12f6f5e1045d8164b9f59998d3bdc300fc92843489.4e4d4b52": { ticker: "NMKR", decimals: 6 },
  "5dac8536653edc12f6f5e1045d8164b9f59998d3bdc300fc928434894e4d4b52": { ticker: "NMKR", decimals: 6 },
  "682fe60c9918842b3323c43b5144bc3d52a23bd2fb81345560d73f63.4e45574d": { ticker: "NEWM", decimals: 6 },
  "682fe60c9918842b3323c43b5144bc3d52a23bd2fb81345560d73f634e45574d": { ticker: "NEWM", decimals: 6 },
  "da8c30857834c6ae7203935b89278c532b3995245295456f993e1d24.4c51": { ticker: "LQ", decimals: 6 },
  "da8c30857834c6ae7203935b89278c532b3995245295456f993e1d244c51": { ticker: "LQ", decimals: 6 },
  "f43a62fdc3965df486de8a0d32fe800963589c41b38946602a0dc535.41474958": { ticker: "AGIX", decimals: 8 },
  "f43a62fdc3965df486de8a0d32fe800963589c41b38946602a0dc53541474958": { ticker: "AGIX", decimals: 8 },
  "1d7f33bd23d85e1a25d87d86fac4f199c3197a2f7afeb662a0f34e1e.776f726c646d6f62696c65746f6b656e": { ticker: "WMT", decimals: 6 },
  "1d7f33bd23d85e1a25d87d86fac4f199c3197a2f7afeb662a0f34e1e776f726c646d6f62696c65746f6b656e": { ticker: "WMT", decimals: 6 },
  "04b95368393c821f180deee8229fbd941baaf9bd748ebcdbf7adbb14.7273455247": { ticker: "rsERG", decimals: 6 },
  "04b95368393c821f180deee8229fbd941baaf9bd748ebcdbf7adbb147273455247": { ticker: "rsERG", decimals: 6 },
  "f5f8e854af532d828d00381df799ba6db22d825c9b140e1d5795cf85.0014df10447261676f6e476f6c64": { ticker: "DragonGold", decimals: 6 },
  "f5f8e854af532d828d00381df799ba6db22d825c9b140e1d5795cf850014df10447261676f6e476f6c64": { ticker: "DragonGold", decimals: 6 },
  "804f5544c1962a40546827cab750a88404dc7108c0f588b72964754f.56594649": { ticker: "VYFI", decimals: 6 },
  "804f5544c1962a40546827cab750a88404dc7108c0f588b72964754f56594649": { ticker: "VYFI", decimals: 6 },
  "fc11a9ef431f81b837736be5f53e4da29b9469c983d07f321262ce61.4652454e": { ticker: "FREN", decimals: 0 },
  "fc11a9ef431f81b837736be5f53e4da29b9469c983d07f321262ce614652454e": { ticker: "FREN", decimals: 0 },
  "edfd7a1d77bcb8b884c474bdc92a16002d1fb720e454fa6e99344479.4e5458": { ticker: "NTX", decimals: 6 },
  "edfd7a1d77bcb8b884c474bdc92a16002d1fb720e454fa6e993444794e5458": { ticker: "NTX", decimals: 6 },
  "ee0633e757fdd1423220f43688c74678abde1cead7ce265ba8a24fcd.43424c50": { ticker: "CBLP", decimals: 6 },
  "ee0633e757fdd1423220f43688c74678abde1cead7ce265ba8a24fcd43424c50": { ticker: "CBLP", decimals: 6 },
  "95a427e384527065f2f8946f5e86320d0117839a5e98ea2c0b55fb00.48554e54": { ticker: "HUNT", decimals: 6 },
  "95a427e384527065f2f8946f5e86320d0117839a5e98ea2c0b55fb0048554e54": { ticker: "HUNT", decimals: 6 },
  "9a9693a9a37912a5097918f97918d15240c92ab729a0b7c4aa144d77.53554e444145": { ticker: "SUNDAE", decimals: 6 },
  "9a9693a9a37912a5097918f97918d15240c92ab729a0b7c4aa144d7753554e444145": { ticker: "SUNDAE", decimals: 6 },
  "a2944573e99d2ed3055b808eaa264f0bf119e01fc6b18863067c63e4.4d454c44": { ticker: "MELD", decimals: 6 },
  "a2944573e99d2ed3055b808eaa264f0bf119e01fc6b18863067c63e44d454c44": { ticker: "MELD", decimals: 6 },
  "af2e27f580f7f08e93190a81f72462f153026d06450924726645891b.44524950": { ticker: "DRIP", decimals: 6 },
  "af2e27f580f7f08e93190a81f72462f153026d06450924726645891b44524950": { ticker: "DRIP", decimals: 6 },
};

export function resolveTokenMeta(unit: string): { ticker: string; decimals: number } {
  if (unit === "lovelace") return { ticker: "ADA", decimals: 6 };
  if (KNOWN_REWARD_TOKENS[unit]) return KNOWN_REWARD_TOKENS[unit];

  const dotUnit = unit.includes(".") ? unit : `${unit.slice(0, 56)}.${unit.slice(56)}`;
  if (KNOWN_REWARD_TOKENS[dotUnit]) return KNOWN_REWARD_TOKENS[dotUnit];

  const hexName = unit.includes(".") ? unit.split(".")[1] : unit.slice(56);
  if (hexName) {
    try {
      let ascii = "";
      for (let i = 0; i < hexName.length; i += 2) {
        const code = parseInt(hexName.substr(i, 2), 16);
        if (code >= 32 && code <= 126) {
          ascii += String.fromCharCode(code);
        }
      }
      if (ascii.length > 0) {
        return { ticker: ascii, decimals: 6 };
      }
    } catch {
      // ignore
    }
  }

  return { ticker: unit.slice(0, 8) + "...", decimals: 6 };
}

interface RewardSnapshot {
  datumHash: string;
  poolType: string;
  epochDate: string;
  gistUrl: string;
  rewards: Record<string, Record<string, number>>;
}

let vsSnapshotCache: RewardSnapshot | null = null;
let aySnapshotCache: RewardSnapshot | null = null;

export async function loadRewardsSnapshot(
  type: "vault-staking" | "accelerated-yield"
): Promise<RewardSnapshot | null> {
  try {
    if (type === "vault-staking" && vsSnapshotCache) return vsSnapshotCache;
    if (type === "accelerated-yield" && aySnapshotCache) return aySnapshotCache;

    const res = await fetch(`/data/rewards-${type}.json`);
    if (!res.ok) return null;
    const data: RewardSnapshot = await res.json();
    if (type === "vault-staking") vsSnapshotCache = data;
    else aySnapshotCache = data;
    return data;
  } catch (err) {
    console.warn(`Failed to fetch /data/rewards-${type}.json:`, err);
    return null;
  }
}

function hexToUtf8(hex: string): string {
  try {
    let str = "";
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return str;
  } catch {
    return "";
  }
}

export async function fetchActiveRewardPools(
  lucid: LucidEvolution,
  network: NetworkType,
  userAddress?: string,
  blockfrostApiKey?: string
): Promise<RewardPool[]> {
  const constants = DEX_CONSTANTS[network];
  const rewardsAddr = constants.rewardsAddr;
  const gensUnit = DEFAULT_MAINNET_TOKENS[1].unit;
  const gensXUnit = "fbae99b8679369079a7f6f0da14a2cf1c2d6bfd3afdf3a96a64ab67a0014df1047454e5358";

  let scriptUtxos: UTxO[] = [];
  try {
    scriptUtxos = await lucid.utxosAt(rewardsAddr);
  } catch (err) {
    console.error("Failed to query rewards address UTxOs:", err);
    return [];
  }

  // Pre-load rewards snapshots for user lookup
  const [vsSnapshot, aySnapshot] = await Promise.all([
    loadRewardsSnapshot("vault-staking"),
    loadRewardsSnapshot("accelerated-yield"),
  ]);

  // Determine user's stake credential (pkh)
  let userSkh: string | null = null;
  if (userAddress) {
    try {
      const details = getAddressDetails(userAddress);
      userSkh = details.stakeCredential?.hash || details.paymentCredential?.hash || null;
    } catch {
      if (/^[0-9a-fA-F]{56}$/.test(userAddress)) {
        userSkh = userAddress.toLowerCase();
      }
    }
  }

  const pools: RewardPool[] = [];

  for (const utxo of scriptUtxos) {
    // Skip dust UTxOs without datum
    if (!utxo.datum && !utxo.datumHash) {
      continue;
    }

    const lovelace = utxo.assets.lovelace || 0n;
    const gens = utxo.assets[gensUnit] || 0n;
    const gensX = utxo.assets[gensXUnit] || 0n;

    let poolType: "Vault Staking" | "Accelerated Yield" =
      gens > 500_000_000_000n || lovelace > 1_000_000_000n
        ? "Vault Staking"
        : "Accelerated Yield";

    let epochDate = poolType === "Vault Staking" ? vsSnapshot?.epochDate : aySnapshot?.epochDate;
    let gistUrl = poolType === "Vault Staking" ? vsSnapshot?.gistUrl : aySnapshot?.gistUrl;
    let infoString = `${poolType} (${utxo.txHash.slice(0, 10)}...#${utxo.outputIndex})`;

    // Try fetching datum from Blockfrost if datumHash is present
    if (utxo.datumHash && blockfrostApiKey) {
      try {
        const datumRes = await fetch(`${constants.blockfrostUrl}/scripts/datum/${utxo.datumHash}`, {
          headers: { project_id: blockfrostApiKey },
        });
        if (datumRes.ok) {
          const datumJson = await datumRes.json();
          const fields = datumJson?.json_value?.fields;
          if (fields && fields.length > 0 && fields[0]?.bytes) {
            const decodedInfo = hexToUtf8(fields[0].bytes);
            if (decodedInfo) {
              infoString = decodedInfo;
              if (decodedInfo.startsWith("VAULT_STAKING")) {
                poolType = "Vault Staking";
                const parts = decodedInfo.split(":");
                if (parts[1]) epochDate = parts[1];
              } else if (decodedInfo.startsWith("ACCELERATED_YIELD")) {
                poolType = "Accelerated Yield";
                const parts = decodedInfo.split(":");
                if (parts[1]) epochDate = parts[1];
              }
            }
          }
          if (fields && fields[3]?.fields && fields[3].fields[1]?.bytes) {
            const decodedUrl = hexToUtf8(fields[3].fields[1].bytes);
            if (decodedUrl && decodedUrl.startsWith("http")) {
              gistUrl = decodedUrl;
            }
          }
        }
      } catch (e) {
        console.warn("Failed to fetch/parse datum from Blockfrost:", e);
      }
    }

    // Build all available assets in this pool
    const availableAssets: RewardAsset[] = [];
    for (const [unit, amt] of Object.entries(utxo.assets)) {
      if (unit === "lovelace") {
        availableAssets.push({ unit, ticker: "ADA", amount: amt, decimals: 6 });
      } else {
        const meta = resolveTokenMeta(unit);
        availableAssets.push({ unit, ticker: meta.ticker, amount: amt, decimals: meta.decimals });
      }
    }

    // Sort pool assets: GENS, GENSX, ADA first, then highest amount
    availableAssets.sort((a, b) => {
      const priorityOrder: Record<string, number> = { GENS: 1, GENSX: 2, ADA: 3 };
      const prioA = priorityOrder[a.ticker] || 99;
      const prioB = priorityOrder[b.ticker] || 99;
      if (prioA !== prioB) return prioA - prioB;
      return b.amount > a.amount ? 1 : -1;
    });

    // Check if user has already withdrawn rewards from this exact UTxO in this browser session
    let localSessionClaimed = false;
    if (userSkh) {
      try {
        const localKey = `genius_zero_claimed_v2_${userSkh.toLowerCase()}_${utxo.txHash}#${utxo.outputIndex}`;
        if (localStorage.getItem(localKey)) {
          localSessionClaimed = true;
        }
      } catch {}
    }

    const snapshot = poolType === "Vault Staking" ? vsSnapshot : aySnapshot;
    let userAlloc: Record<string, number> =
      snapshot && userSkh && snapshot.rewards[userSkh] ? { ...snapshot.rewards[userSkh] } : {};
    let lastWithdrawnAlloc: Record<string, number> | null = null;
    let userClaimed = false;

    // Traverse on-chain datum chain ONLY back to snapshot.datumHash, then replay post-snapshot
    // TopUp and Withdraw actions in chronological order (oldest -> newest).
    if (userSkh && utxo.datumHash && blockfrostApiKey && snapshot?.datumHash) {
      type PostSnapshotStep =
        | { kind: "withdraw"; pkh: string }
        | { kind: "topup"; gistUrl: string };

      const stepsNewestFirst: PostSnapshotStep[] = [];
      let curDatumHash: string | null = utxo.datumHash;
      let depth = 0;

      while (curDatumHash && curDatumHash !== snapshot.datumHash && depth < 50) {
        depth++;
        try {
          const dRes = await fetch(`${constants.blockfrostUrl}/scripts/datum/${curDatumHash}`, {
            headers: { project_id: blockfrostApiKey },
          });
          if (!dRes.ok) break;
          const dJson = await dRes.json();
          const dFields = dJson?.json_value?.fields;
          if (!dFields || dFields.length < 4) break;

          const lastAction = dFields[3];
          if (lastAction?.constructor === 1 && lastAction?.fields?.[0]?.bytes) {
            stepsNewestFirst.push({
              kind: "withdraw",
              pkh: lastAction.fields[0].bytes.toLowerCase(),
            });
          } else if (lastAction?.constructor === 0 && lastAction?.fields?.[1]?.bytes) {
            const stepGistUrl = hexToUtf8(lastAction.fields[1].bytes);
            if (stepGistUrl && stepGistUrl.startsWith("http")) {
              stepsNewestFirst.push({
                kind: "topup",
                gistUrl: stepGistUrl,
              });
            }
          }

          const prevField = dFields[1];
          if (prevField?.fields?.[0]?.bytes) {
            curDatumHash = prevField.fields[0].bytes;
          } else {
            curDatumHash = null;
          }
        } catch {
          break;
        }
      }

      const stepsChronological = stepsNewestFirst.reverse();
      const lowerSkh = userSkh.toLowerCase();

      for (const step of stepsChronological) {
        if (step.kind === "withdraw") {
          if (step.pkh === lowerSkh) {
            lastWithdrawnAlloc = { ...userAlloc };
            userAlloc = {};
            userClaimed = true;
          }
        } else if (step.kind === "topup") {
          try {
            const gRes = await fetch(step.gistUrl);
            if (gRes.ok) {
              const gJson = await gRes.json();
              if (Array.isArray(gJson)) {
                for (const entry of gJson) {
                  if (
                    Array.isArray(entry) &&
                    typeof entry[0] === "string" &&
                    entry[0].toLowerCase() === lowerSkh &&
                    entry[1] &&
                    typeof entry[1] === "object"
                  ) {
                    let addedAny = false;
                    for (const [u, amt] of Object.entries(entry[1] as Record<string, number>)) {
                      const num = Number(amt);
                      if (num > 0) {
                        userAlloc[u] = (userAlloc[u] || 0) + num;
                        addedAny = true;
                      }
                    }
                    if (addedAny) {
                      userClaimed = false;
                    }
                  }
                }
              }
            }
          } catch {
            // ignore individual Gist fetch errors
          }
        }
      }
    }

    if (localSessionClaimed && !userClaimed) {
      lastWithdrawnAlloc = { ...userAlloc };
      userAlloc = {};
      userClaimed = true;
    }

    // Lookup user's rewards allocation
    let userClaimableLovelace = 0n;
    let userClaimableGens = 0n;
    let userClaimableGensX = 0n;
    const userClaimableTokens: RewardAsset[] = [];

    let userClaimedLovelace = 0n;
    let userClaimedGens = 0n;
    let userClaimedGensX = 0n;
    const userClaimedTokens: RewardAsset[] = [];

    const activeAlloc = userClaimed ? lastWithdrawnAlloc || {} : userAlloc;
    if (userSkh && Object.keys(activeAlloc).length > 0) {
      const parsedTokens: RewardAsset[] = [];
      let parsedLovelace = 0n;
      let parsedGens = 0n;
      let parsedGensX = 0n;

      for (const [rawUnit, amtNum] of Object.entries(activeAlloc)) {
        const amt = BigInt(Math.floor(amtNum));
        if (amt <= 0n) continue;

        if (rawUnit === "lovelace") {
          parsedLovelace += amt;
        } else {
          const meta = resolveTokenMeta(rawUnit);
          if (meta.ticker === "GENS") {
            parsedGens += amt;
          } else if (meta.ticker === "GENSX") {
            parsedGensX += amt;
          }
          parsedTokens.push({
            unit: rawUnit,
            ticker: meta.ticker,
            amount: amt,
            decimals: meta.decimals,
          });
        }
      }

      // Sort user tokens: GENS, GENSX, ADA first, then highest amount
      parsedTokens.sort((a, b) => {
        const priorityOrder: Record<string, number> = { GENS: 1, GENSX: 2, ADA: 3 };
        const prioA = priorityOrder[a.ticker] || 99;
        const prioB = priorityOrder[b.ticker] || 99;
        if (prioA !== prioB) return prioA - prioB;
        return b.amount > a.amount ? 1 : -1;
      });

      if (userClaimed) {
        userClaimedLovelace = parsedLovelace;
        userClaimedGens = parsedGens;
        userClaimedGensX = parsedGensX;
        userClaimedTokens.push(...parsedTokens);
      } else {
        userClaimableLovelace = parsedLovelace;
        userClaimableGens = parsedGens;
        userClaimableGensX = parsedGensX;
        userClaimableTokens.push(...parsedTokens);
      }
    }

    if (userClaimed && userSkh) {
      try {
        const localKey = `genius_zero_claimed_v2_${userSkh.toLowerCase()}_${utxo.txHash}#${utxo.outputIndex}`;
        localStorage.setItem(localKey, "true");
      } catch {}
    }

    pools.push({
      utxoRef: {
        txHash: utxo.txHash,
        outputIndex: utxo.outputIndex,
      },
      poolType,
      infoString,
      epochDate,
      gistUrl,
      availableLovelace: lovelace,
      availableGens: gens,
      availableGensX: gensX,
      availableAssets,
      userClaimableLovelace,
      userClaimableGens,
      userClaimableGensX,
      userClaimableTokens,
      userClaimed,
      userClaimedLovelace,
      userClaimedGens,
      userClaimedGensX,
      userClaimedTokens,
    });
  }

  // Sort pools: Vault Staking first, Accelerated Yield second
  pools.sort((a, b) => (a.poolType === "Vault Staking" ? -1 : 1));

  return pools;
}

export interface ClaimRewardsParams {
  network: NetworkType;
  walletApi: any;
  stakeAddress: string;
  userAddresses: string[];
  changeAddress: string;
  claimServiceUrl?: string;
  blockfrostApiKey?: string;
}

export interface PrepareClaimParams {
  network: NetworkType;
  stakeAddress: string;
  userAddresses: string[];
  changeAddress: string;
  claimServiceUrl?: string;
}

export async function prepareClaimTransaction(params: PrepareClaimParams): Promise<{ cbor: string; txId: string }> {
  const constants = DEX_CONSTANTS[params.network];
  const serviceUrl = params.claimServiceUrl || constants.claimServiceUrl;

  const response = await fetch(`${serviceUrl}/api/v1/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      crStakeAddress: params.stakeAddress,
      crUserAddresses: params.userAddresses,
      crChangeAddress: params.changeAddress,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claim microservice error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const crespTxCbor = data.crespTxCbor;
  if (!crespTxCbor) {
    throw new Error("Invalid response from claim microservice: missing transaction CBOR");
  }

  return { cbor: crespTxCbor, txId: data.crespTxId };
}

export interface SignAndSubmitClaimParams {
  network: NetworkType;
  walletApi: any;
  txCbor: string;
  blockfrostApiKey?: string;
}

export async function signAndSubmitClaimTransaction(params: SignAndSubmitClaimParams): Promise<{ txHash: string }> {
  const constants = DEX_CONSTANTS[params.network];

  // 1. Request user signature witness via CIP-30 wallet
  const userWitnessCbor = await params.walletApi.signTx(params.txCbor, true);

  // 2. Assemble the transaction: merge the user's witness into the co-signed transaction
  const tx = CML.Transaction.from_cbor_hex(params.txCbor);
  const userWitnessSet = CML.TransactionWitnessSet.from_cbor_hex(userWitnessCbor);
  const witnessSet = tx.witness_set();
  witnessSet.add_all_witnesses(userWitnessSet);
  const finalTx = CML.Transaction.new(tx.body(), witnessSet, tx.is_valid(), tx.auxiliary_data());
  const finalTxCbor = finalTx.to_cbor_hex();

  // 3. Submit transaction to Cardano network
  let txHash: string;
  try {
    txHash = await params.walletApi.submitTx(finalTxCbor);
  } catch (walletErr) {
    console.warn("Wallet submitTx failed, falling back to Blockfrost direct submit:", walletErr);
    if (!params.blockfrostApiKey) {
      throw walletErr;
    }
    const bfSubmitRes = await fetch(`${constants.blockfrostUrl}/tx/submit`, {
      method: "POST",
      headers: {
        "project_id": params.blockfrostApiKey,
        "Content-Type": "application/cbor",
      },
      body: new Blob([fromHex(finalTxCbor) as any], { type: "application/cbor" }),
    });
    if (!bfSubmitRes.ok) {
      const errBody = await bfSubmitRes.text();
      throw new Error(`Transaction submission failed: ${errBody}`);
    }
    txHash = (await bfSubmitRes.json()) as string;
  }

  return { txHash };
}

export interface ClaimRewardsParams {
  network: NetworkType;
  walletApi: any;
  stakeAddress: string;
  userAddresses: string[];
  changeAddress: string;
  claimServiceUrl?: string;
  blockfrostApiKey?: string;
}

export async function executeClaimRewards(params: ClaimRewardsParams): Promise<{ txHash: string }> {
  const prepared = await prepareClaimTransaction({
    network: params.network,
    stakeAddress: params.stakeAddress,
    userAddresses: params.userAddresses,
    changeAddress: params.changeAddress,
    claimServiceUrl: params.claimServiceUrl,
  });

  return signAndSubmitClaimTransaction({
    network: params.network,
    walletApi: params.walletApi,
    txCbor: prepared.cbor,
    blockfrostApiKey: params.blockfrostApiKey,
  });
}

