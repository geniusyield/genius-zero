import {
  Blockfrost,
  Lucid,
  LucidEvolution,
  Network,
  UTxO,
  getAddressDetails,
  paymentCredentialOf,
  addressFromHexOrBech32,
  credentialToRewardAddress,
} from "@lucid-evolution/lucid";
import { NetworkType } from "../types";
import { DEX_CONSTANTS } from "../config/dex";

let lucidInstance: LucidEvolution | null = null;
let currentApiKey = "";
let currentNetwork: NetworkType = "mainnet";

/**
 * Normalizes a Cardano address (whether hex-encoded from CIP-30 or bech32) to standard bech32.
 */
export function toAddressBech32(rawAddr: string): string | null {
  if (!rawAddr) return null;
  if (rawAddr.startsWith("addr") || rawAddr.startsWith("stake")) {
    return rawAddr;
  }
  try {
    const cml = addressFromHexOrBech32(rawAddr);
    return cml.to_bech32();
  } catch {
    return null;
  }
}

export async function getLucid(
  apiKey: string,
  network: NetworkType
): Promise<LucidEvolution> {
  const lucidNetwork: Network = network === "mainnet" ? "Mainnet" : "Preprod";

  if (lucidInstance && currentApiKey === apiKey && currentNetwork === network) {
    return lucidInstance;
  }

  const endpoint = DEX_CONSTANTS[network].blockfrostUrl;
  const provider = new Blockfrost(endpoint, apiKey);

  // Intercept getProtocolParameters to catch HTTP errors (e.g. 402 Project Over Limit, 403, 429)
  // before @lucid-evolution/provider attempts to parse undefined properties into BigInt.
  const origGetProtocolParameters = provider.getProtocolParameters.bind(provider);
  provider.getProtocolParameters = async () => {
    try {
      const res = await fetch(`${endpoint}/epochs/latest/parameters`, {
        headers: { project_id: apiKey },
      });
      if (!res.ok) {
        let body: any = null;
        try {
          body = await res.json();
        } catch {}
        const status = res.status || body?.status_code;
        const msg = body?.message || body?.error || res.statusText;
        if (status === 402) {
          throw new Error(
            `Blockfrost project over daily limit (50,000 requests). Reset occurs at 00:00 UTC, or configure a new Blockfrost ${network === "mainnet" ? "Mainnet" : "Preprod"} project key in Settings.`
          );
        }
        if (status === 403) {
          throw new Error(
            `Invalid Blockfrost project key for ${network}. Please check your API key in Settings.`
          );
        }
        if (status === 429) {
          throw new Error(
            `Blockfrost rate limit exceeded (too many requests per second). Please slow down and try again.`
          );
        }
        throw new Error(`Blockfrost API error (${status}): ${msg}`);
      }
    } catch (fetchErr: any) {
      if (fetchErr.message && fetchErr.message.includes("Blockfrost")) {
        throw fetchErr;
      }
      throw new Error(`Failed to reach Blockfrost: ${fetchErr?.message || "Network error"}`);
    }
    return origGetProtocolParameters();
  };

  lucidInstance = await Lucid(provider, lucidNetwork);
  patchProviderEvaluation(lucidInstance);
  currentApiKey = apiKey;
  currentNetwork = network;

  return lucidInstance;
}

/**
 * Monkey-patches provider.evaluateTx to fix two known upstream bugs in @lucid-evolution with Blockfrost/Ogmios:
 * 1. Ogmios fails when additionalUtxoSet contains on-chain multi-assets ("failed to decode payload from base64 or base16")
 *    or fails with AdditionalUtxoOverlap. Since transactions on confirmed inputs don't need additionalUtxoSet,
 *    we evaluate with [] first.
 * 2. Ogmios returns redeemer pointers as "withdrawal:0", which @lucid-evolution/provider exposes as
 *    redeemer_tag: "withdrawal", but @lucid-evolution/utils toCMLRedeemerTag only handles "withdraw".
 */
export function patchProviderEvaluation(lucid: LucidEvolution) {
  const provider = lucid.config().provider as any;
  if (!provider || provider._evaluationPatched) return;

  const originalEvaluateTx = provider.evaluateTx.bind(provider);
  provider.evaluateTx = async (tx: string, additionalUTxOs?: any[]) => {
    let rawRedeemers;
    try {
      rawRedeemers = await originalEvaluateTx(tx, []);
    } catch (errFirst) {
      try {
        rawRedeemers = await originalEvaluateTx(tx, additionalUTxOs);
      } catch {
        throw errFirst;
      }
    }

    return rawRedeemers.map((r: any) => ({
      ...r,
      redeemer_tag: r.redeemer_tag === "withdrawal" ? "withdraw" : r.redeemer_tag,
    }));
  };

  provider._evaluationPatched = true;
}

export function resetLucid() {
  lucidInstance = null;
  currentApiKey = "";
}

export interface AvailableWallet {
  id: string;
  name: string;
  icon: string;
  apiVersion: string;
}

export function getAvailableWallets(): AvailableWallet[] {
  if (typeof window === "undefined" || !("cardano" in window)) {
    return [];
  }

  const cardano = (window as any).cardano;
  const wallets: AvailableWallet[] = [];

  const knownWallets = [
    { id: "eternl", name: "Eternl" },
    { id: "lace", name: "Lace" },
    { id: "vespr", name: "Vespr" },
    { id: "nami", name: "Nami" },
    { id: "flint", name: "Flint" },
    { id: "typhoncip30", name: "Typhon" },
    { id: "yoroi", name: "Yoroi" },
    { id: "nufi", name: "NuFi" },
    { id: "begin", name: "Begin" },
    { id: "gerowallet", name: "GeroWallet" },
  ];

  for (const w of knownWallets) {
    if (cardano[w.id]) {
      wallets.push({
        id: w.id,
        name: cardano[w.id].name || w.name,
        icon: cardano[w.id].icon || "",
        apiVersion: cardano[w.id].apiVersion || "1.0.0",
      });
    }
  }

  // Also catch any unknown CIP-30 wallets injected into window.cardano
  for (const key of Object.keys(cardano)) {
    if (
      typeof cardano[key] === "object" &&
      cardano[key]?.enable &&
      !wallets.some((w) => w.id === key)
    ) {
      wallets.push({
        id: key,
        name: cardano[key].name || key,
        icon: cardano[key].icon || "",
        apiVersion: cardano[key].apiVersion || "1.0.0",
      });
    }
  }

  return wallets;
}

export async function connectWallet(
  lucid: LucidEvolution,
  walletId: string
): Promise<{
  address: string;
  networkId: number | null;
  usedAddresses: string[];
  rewardAddress: string | null;
  pkh: string;
  pkhs: string[];
  balanceLovelace: bigint;
  tokenBalances: Record<string, bigint>;
  utxos: UTxO[];
}> {
  if (typeof window === "undefined" || !(window as any).cardano?.[walletId]) {
    throw new Error(`Wallet ${walletId} is not installed or available.`);
  }

  const walletApi = await (window as any).cardano[walletId].enable();

  let networkId: number | null = null;
  try {
    if (typeof walletApi.getNetworkId === "function") {
      networkId = await walletApi.getNetworkId();
    }
  } catch (err) {
    console.warn("Could not query walletApi.getNetworkId():", err);
  }

  lucid.selectWallet.fromAPI(walletApi);

  const address = await lucid.wallet().address();
  const utxos = await lucid.wallet().getUtxos();

  let usedAddresses: string[] = [address];
  let rewardAddress: string | null = null;
  const pkhsSet = new Set<string>();

  // Attempt to gather all used addresses in multi-address wallets (e.g. Eternl)
  try {
    const rawUsed: string[] = await walletApi.getUsedAddresses();
    if (Array.isArray(rawUsed) && rawUsed.length > 0) {
      for (const raw of rawUsed) {
        try {
          const bech32 = toAddressBech32(raw);
          if (bech32) {
            const details = getAddressDetails(bech32);
            if (!usedAddresses.includes(bech32)) {
              usedAddresses.push(bech32);
            }
            if (details.paymentCredential?.hash) {
              pkhsSet.add(details.paymentCredential.hash.toLowerCase());
            }
          }
        } catch {
          // ignore individual address decode failure
        }
      }
    }
  } catch {
    // walletApi.getUsedAddresses might not be supported on all providers
  }

  try {
    const rawRewards: string[] = await walletApi.getRewardAddresses();
    if (Array.isArray(rawRewards) && rawRewards.length > 0) {
      const bech32 = toAddressBech32(rawRewards[0]);
      if (bech32) {
        rewardAddress = bech32;
      }
    }
  } catch {
    // ignore
  }

  // Fallback: derive stake/reward address from primary Shelley base address
  if (!rewardAddress) {
    try {
      const details = getAddressDetails(address);
      if (details.stakeCredential) {
        const net: Network = currentNetwork === "mainnet" ? "Mainnet" : "Preprod";
        rewardAddress = credentialToRewardAddress(net, details.stakeCredential);
      }
    } catch {}
  }

  let balanceLovelace = 0n;
  const tokenBalances: Record<string, bigint> = {};

  for (const utxo of utxos) {
    for (const [unit, amount] of Object.entries(utxo.assets)) {
      if (unit === "lovelace") {
        balanceLovelace += amount;
      } else {
        tokenBalances[unit] = (tokenBalances[unit] || 0n) + amount;
      }
    }
  }

  // Extract primary payment credential hash
  const pkh = paymentCredentialOf(address).hash;
  pkhsSet.add(pkh);

  return {
    address,
    networkId,
    usedAddresses,
    rewardAddress,
    pkh,
    pkhs: Array.from(pkhsSet),
    balanceLovelace,
    tokenBalances,
    utxos,
  };
}
