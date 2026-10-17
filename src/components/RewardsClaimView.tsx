import React, { useState, useEffect } from "react";
import {
  Gift,
  AlertTriangle,
  ExternalLink,
  Loader2,
  RefreshCw,
  Coins,
  ShieldCheck,
  CheckCircle2,
  Download,
  ChevronDown,
  ChevronUp,
  FileCode2,
  KeyRound,
  Layers,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { DEX_CONSTANTS } from "../config/dex";
import {
  fetchActiveRewardPools,
  prepareClaimTransaction,
  signAndSubmitClaimTransaction,
  RewardPool,
  RewardAsset,
} from "../services/rewards";
import { getAddressDetails, credentialToRewardAddress } from "@lucid-evolution/lucid";

interface RewardsClaimViewProps {
  onOpenWallet: () => void;
  onOpenSettings: () => void;
}

export const RewardsClaimView: React.FC<RewardsClaimViewProps> = ({
  onOpenWallet,
  onOpenSettings,
}) => {
  const { wallet, settings, lucid } = useApp();
  const [pools, setPools] = useState<RewardPool[]>([]);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [preparedTx, setPreparedTx] = useState<{ cbor: string; txId: string } | null>(null);
  const [signing, setSigning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [claimTxHash, setClaimTxHash] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [expandedPool, setExpandedPool] = useState<string | null>(null);

  const constants = DEX_CONSTANTS[settings.network];

  const userStakeKeyHash = React.useMemo(() => {
    if (!wallet.address) return null;
    try {
      const details = getAddressDetails(wallet.address);
      return details.stakeCredential?.hash || details.paymentCredential?.hash || null;
    } catch {
      return null;
    }
  }, [wallet.address]);

  const loadPools = async () => {
    if (!lucid) return;
    setLoading(true);
    try {
      const res = await fetchActiveRewardPools(
        lucid,
        settings.network,
        wallet.address || undefined,
        settings.blockfrostApiKey || undefined
      );
      setPools(res);
    } catch (err) {
      console.error("Failed to load reward pools:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (lucid) {
      loadPools();
    }
  }, [lucid, wallet.address, settings.blockfrostApiKey]);

  const totalUserLovelace = pools.reduce((acc, p) => acc + p.userClaimableLovelace, 0n);
  const totalUserGens = pools.reduce((acc, p) => acc + p.userClaimableGens, 0n);
  const totalUserGensX = pools.reduce((acc, p) => acc + p.userClaimableGensX, 0n);

  const allUserPartnerTokens = React.useMemo(() => {
    const map = new Map<string, RewardAsset>();
    for (const p of pools) {
      for (const t of p.userClaimableTokens) {
        if (t.ticker === "GENS" || t.ticker === "GENSX" || t.ticker === "ADA") continue;
        const existing = map.get(t.ticker);
        if (existing) {
          existing.amount += t.amount;
        } else {
          map.set(t.ticker, { ...t });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => (b.amount > a.amount ? 1 : -1));
  }, [pools]);

  const hasAnyUserRewards =
    totalUserLovelace > 0n || totalUserGens > 0n || totalUserGensX > 0n || allUserPartnerTokens.length > 0;

  const totalClaimedLovelace = pools.reduce((acc, p) => acc + (p.userClaimedLovelace || 0n), 0n);
  const totalClaimedGens = pools.reduce((acc, p) => acc + (p.userClaimedGens || 0n), 0n);
  const totalClaimedGensX = pools.reduce((acc, p) => acc + (p.userClaimedGensX || 0n), 0n);

  const allClaimedPartnerTokens = React.useMemo(() => {
    const map = new Map<string, RewardAsset>();
    for (const p of pools) {
      for (const t of p.userClaimedTokens || []) {
        if (t.ticker === "GENS" || t.ticker === "GENSX" || t.ticker === "ADA") continue;
        const existing = map.get(t.ticker);
        if (existing) {
          existing.amount += t.amount;
        } else {
          map.set(t.ticker, { ...t });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => (b.amount > a.amount ? 1 : -1));
  }, [pools]);

  const hasAnyClaimedRewards =
    totalClaimedLovelace > 0n || totalClaimedGens > 0n || totalClaimedGensX > 0n || allClaimedPartnerTokens.length > 0;
  const isAnyPoolClaimed = pools.some((p) => p.userClaimed);
  const isAllClaimed = (isAnyPoolClaimed || hasAnyClaimedRewards) && !hasAnyUserRewards;

  // Timer effect when preparing
  useEffect(() => {
    let interval: any;
    if (preparing) {
      setElapsedSeconds(0);
      interval = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => clearInterval(interval);
  }, [preparing]);

  const handlePrepareClaim = async () => {
    if (!wallet.connected || !wallet.address || !wallet.walletName) {
      onOpenWallet();
      return;
    }

    setPreparing(true);
    setPreparedTx(null);
    setClaimError(null);
    setClaimTxHash(null);
    try {
      const details = getAddressDetails(wallet.address);
      const networkParam = settings.network === "mainnet" ? "Mainnet" : "Preprod";
      const stakeAddr =
        wallet.rewardAddress ||
        (details.stakeCredential ? credentialToRewardAddress(networkParam, details.stakeCredential) : null);

      if (!stakeAddr) {
        throw new Error("Could not determine stake address from connected wallet.");
      }

      let usedAddrs =
        wallet.usedAddresses && wallet.usedAddresses.length > 0
          ? wallet.usedAddresses
          : [wallet.address];
      let changeAddr = wallet.address;

      // Prefer a single funded address (>= 3 ADA) from the wallet's UTxOs so the claim
      // microservice only needs to query 1 address and use 1 payment key witness.
      if (lucid) {
        try {
          const walletUtxos = await lucid.wallet().getUtxos();
          const lovelaceByAddr = new Map<string, bigint>();
          for (const u of walletUtxos) {
            if (u.address) {
              const cur = lovelaceByAddr.get(u.address) || 0n;
              lovelaceByAddr.set(u.address, cur + (u.assets?.lovelace || 0n));
            }
          }
          let bestAddr: string | null = null;
          let bestLovelace = 0n;
          for (const [addr, lov] of lovelaceByAddr.entries()) {
            if (lov >= 3_000_000n && lov > bestLovelace) {
              bestAddr = addr;
              bestLovelace = lov;
            }
          }
          if (bestAddr) {
            usedAddrs = [bestAddr];
            changeAddr = bestAddr;
          }
        } catch {
          // fallback to wallet.usedAddresses / wallet.address
        }
      }

      const res = await prepareClaimTransaction({
        network: settings.network,
        stakeAddress: stakeAddr,
        userAddresses: usedAddrs,
        changeAddress: changeAddr,
        claimServiceUrl: constants.claimServiceUrl,
      });

      setPreparedTx(res);
    } catch (err: any) {
      console.error("Prepare claim error:", err);
      setClaimError(err.message || String(err));
    } finally {
      setPreparing(false);
    }
  };

  const handleSignAndSubmit = async () => {
    if (!preparedTx || !wallet.walletName) return;

    setSigning(true);
    setClaimError(null);
    try {
      if (typeof window === "undefined" || !(window as any).cardano?.[wallet.walletName]) {
        throw new Error(`Wallet ${wallet.walletName} is not accessible in browser.`);
      }

      const walletApi = await (window as any).cardano[wallet.walletName].enable();
      const res = await signAndSubmitClaimTransaction({
        network: settings.network,
        walletApi,
        txCbor: preparedTx.cbor,
        blockfrostApiKey: settings.blockfrostApiKey || undefined,
      });

      setClaimTxHash(res.txHash);
      setPreparedTx(null);

      // Record claim in localStorage and update state immediately
      if (userStakeKeyHash) {
        pools.forEach((p) => {
          if (p.userClaimableGens > 0n || p.userClaimableLovelace > 0n || p.userClaimableTokens.length > 0) {
            try {
              localStorage.setItem(
                `genius_zero_claimed_v2_${userStakeKeyHash.toLowerCase()}_${p.utxoRef.txHash}#${p.utxoRef.outputIndex}`,
                res.txHash
              );
            } catch {}
          }
        });
      }

      setPools((prev) =>
        prev.map((p) => {
          if (p.userClaimableGens > 0n || p.userClaimableLovelace > 0n || p.userClaimableTokens.length > 0) {
            return {
              ...p,
              userClaimed: true,
              userClaimedGens: p.userClaimableGens,
              userClaimedGensX: p.userClaimableGensX,
              userClaimedLovelace: p.userClaimableLovelace,
              userClaimedTokens: p.userClaimableTokens,
              userClaimableGens: 0n,
              userClaimableGensX: 0n,
              userClaimableLovelace: 0n,
              userClaimableTokens: [],
            };
          }
          return p;
        })
      );

      setTimeout(() => {
        loadPools();
      }, 10000);
    } catch (err: any) {
      console.error("Signing error:", err);
      setClaimError(err.message || String(err));
    } finally {
      setSigning(false);
    }
  };

  const formatAmount = (amt: bigint, decimals: number = 6) => {
    return (Number(amt) / Math.pow(10, decimals)).toLocaleString(undefined, {
      minimumFractionDigits: decimals === 0 ? 0 : 2,
      maximumFractionDigits: decimals === 0 ? 0 : 2,
    });
  };

  const explorerBaseUrl =
    settings.network === "mainnet"
      ? "https://cardanoscan.io/address"
      : "https://preprod.cardanoscan.io/address";

  const txExplorerBaseUrl =
    settings.network === "mainnet"
      ? "https://cardanoscan.io/transaction"
      : "https://preprod.cardanoscan.io/transaction";

  return (
    <div className="space-y-6">
      {/* Educational & Operational Alert: Pull vs Push Rewards */}
      <div className="p-5 rounded-2xl bg-rose-950/30 border border-rose-500/40 text-rose-200 shadow-xl space-y-3">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <h2 className="font-bold text-base text-white">
            Critical Insight: Staking Rewards Are Pull-Based (Must Be Claimed)
          </h2>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          Unlike standard Cardano pool delegation, Genius Yield rewards are <strong>NOT pushed directly to user wallets</strong>.
          Instead, weekly rewards are accumulated into on-chain reward UTxOs at the operator address{" "}
          <code className="bg-rose-900/40 px-1.5 py-0.5 rounded text-rose-200 text-[11px] font-mono">
            {constants.rewardsAddr.slice(0, 16)}...{constants.rewardsAddr.slice(-8)}
          </code>
          , backed by public GitHub Gist Merkle allocations.
        </p>
        <p className="text-xs text-rose-300 leading-relaxed font-semibold">
          If central servers shut down on October 15, 2026, users would have no interface to claim their rewards.
          Genius Zero reconstructs and verifies the full cumulative rewards allocations client-side so stakers can view and sovereignly claim their accumulated rewards.
        </p>
        <div className="flex flex-wrap items-center gap-4 text-xs pt-1">
          <a
            href={`${explorerBaseUrl}/${constants.rewardsAddr}`}
            target="_blank"
            rel="noreferrer"
            className="text-rose-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
          >
            Live Rewards Address on Cardanoscan <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Pools & Claim Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active On-Chain Pools (2 Cols on desktop, 2nd on mobile) */}
        <div className="order-2 lg:order-1 lg:col-span-2 bg-[#121824] border border-[#1f2d44] rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#1f2d44]">
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <span>Active On-Chain Reward Pools</span>
              </h3>
              <p className="text-xs text-slate-400">
                Live UTxOs holding rewards at the Genius Yield rewards contract
              </p>
            </div>
            <button
              onClick={loadPools}
              disabled={loading || !lucid}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#182234] border border-[#1f2d44] text-xs font-semibold text-slate-300 hover:text-white transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>

          {!settings.blockfrostApiKey ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-xs text-slate-400">Please configure your Blockfrost API key to query on-chain rewards</p>
              <button
                onClick={onOpenSettings}
                className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/20"
              >
                Configure Key
              </button>
            </div>
          ) : pools.length === 0 ? (
            <div className="text-center py-12 text-xs text-slate-500 italic">
              {loading ? "Scanning on-chain rewards address..." : "No active reward UTxOs found on-chain."}
            </div>
          ) : (
            <div className="space-y-4">
              {pools.map((pool) => {
                const poolId = `${pool.utxoRef.txHash}-${pool.utxoRef.outputIndex}`;
                const isExpanded = expandedPool === poolId;
                const otherAssets = pool.availableAssets.filter(
                  (a) => a.ticker !== "GENS" && a.ticker !== "GENSX" && a.ticker !== "ADA"
                );

                const poolHasUserRewards =
                  pool.userClaimableLovelace > 0n ||
                  pool.userClaimableGens > 0n ||
                  pool.userClaimableGensX > 0n ||
                  pool.userClaimableTokens.length > 0;

                return (
                  <div
                    key={poolId}
                    className="p-4 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-3 transition-all"
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">{pool.poolType}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                            Live Pool
                          </span>
                          {pool.epochDate && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 font-mono">
                              Epoch: {pool.epochDate.slice(0, 10)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
                          <a
                            href={`${txExplorerBaseUrl}/${pool.utxoRef.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-emerald-400 hover:underline flex items-center gap-1"
                          >
                            UTxO: {pool.utxoRef.txHash.slice(0, 12)}...#{pool.utxoRef.outputIndex}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          {pool.gistUrl && (
                            <a
                              href={pool.gistUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-amber-400 hover:underline flex items-center gap-1 font-sans text-[11px]"
                            >
                              <FileCode2 className="w-3 h-3" />
                              <span>On-Chain Gist</span>
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Total Pool Balances */}
                      <div className="text-right font-mono text-xs">
                        <div className="font-bold text-emerald-400 text-sm">
                          {formatAmount(pool.availableGens)} GENS
                        </div>
                        {pool.availableGensX > 0n && (
                          <div className="text-sky-300 text-xs">
                            {formatAmount(pool.availableGensX)} GENSX
                          </div>
                        )}
                        <div className="text-[11px] text-slate-400">
                          {formatAmount(pool.availableLovelace)} ADA
                        </div>
                      </div>
                    </div>

                    {/* Highlighted User Share in This Pool */}
                    {wallet.connected && pool.userClaimed ? (
                      <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/40 text-xs space-y-2">
                        <div className="flex items-center justify-between font-semibold text-emerald-300">
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            <span>Rewards Claimed!</span>
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                            Successfully Withdrawn On-Chain
                          </span>
                        </div>
                        {((pool.userClaimedGens || 0n) > 0n || (pool.userClaimedLovelace || 0n) > 0n) && (
                          <div className="flex items-center justify-between text-slate-300 font-mono text-[11px] pt-0.5">
                            <span>Withdrawn Allocation:</span>
                            <span className="font-bold text-emerald-300">
                              {formatAmount(pool.userClaimedGens || 0n)} GENS
                              {(pool.userClaimedLovelace || 0n) > 0n && ` + ${formatAmount(pool.userClaimedLovelace || 0n)} ADA`}
                            </span>
                          </div>
                        )}
                        {(pool.userClaimedTokens || []).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1 font-mono text-[10px]">
                            {pool.userClaimedTokens!.map((t) => (
                              <span
                                key={t.unit}
                                className="px-2 py-0.5 rounded bg-[#121824] border border-emerald-500/30 text-emerald-200"
                              >
                                {formatAmount(t.amount, t.decimals)} <strong className="text-emerald-400">{t.ticker}</strong>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : wallet.connected && poolHasUserRewards ? (
                      <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs space-y-1.5">
                        <div className="flex items-center justify-between font-semibold text-emerald-300">
                          <span className="flex items-center gap-1.5">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Your Verified Share in this Pool:</span>
                          </span>
                          <span className="font-mono text-emerald-200">
                            {formatAmount(pool.userClaimableGens)} GENS
                            {pool.userClaimableLovelace > 0n && ` + ${formatAmount(pool.userClaimableLovelace)} ADA`}
                          </span>
                        </div>
                        {pool.userClaimableTokens.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1 font-mono text-[11px]">
                            {pool.userClaimableTokens.map((t) => (
                              <span
                                key={t.unit}
                                className="px-2 py-0.5 rounded bg-[#121824] border border-[#1f2d44] text-slate-300"
                              >
                                {formatAmount(t.amount, t.decimals)} <strong className="text-emerald-400">{t.ticker}</strong>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}

                    {/* Expandable Other Partner Tokens in Pool */}
                    {otherAssets.length > 0 && (
                      <div className="pt-1">
                        <button
                          onClick={() => setExpandedPool(isExpanded ? null : poolId)}
                          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 font-semibold transition-colors"
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          <span>
                            {isExpanded
                              ? "Hide Additional Pool Tokens"
                              : `View All ${pool.availableAssets.length} Tokens in Pool (+${otherAssets.length} Partner Assets)`}
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="mt-2.5 p-3 rounded-lg bg-[#121824] border border-[#1f2d44] grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
                            {otherAssets.map((asset) => (
                              <div
                                key={asset.unit}
                                className="p-1.5 rounded bg-[#0b0e14] border border-[#1a2332] flex items-center justify-between"
                              >
                                <span className="text-slate-400 truncate pr-2" title={asset.ticker}>
                                  {asset.ticker}
                                </span>
                                <span className="font-bold text-slate-200 text-[11px]">
                                  {formatAmount(asset.amount, asset.decimals)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Claim Action Box (1 Col on desktop, 1st on mobile) */}
        <div className="order-1 lg:order-2 lg:col-span-1 bg-[#121824] border border-[#1f2d44] rounded-2xl p-4 sm:p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 pb-3 border-b border-[#1f2d44]">
              <Gift className="w-5 h-5 text-emerald-400" />
              <div>
                <h3 className="font-bold text-sm text-white">Your Accrued Rewards</h3>
                <p className="text-xs text-slate-400">Cryptographically verified allocation</p>
              </div>
            </div>

            <div className="mt-4 p-4 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-3">
              <div className="text-xs text-slate-400 flex items-center justify-between">
                <span>Connected Staker:</span>
                {userStakeKeyHash && (
                  <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                    <KeyRound className="w-3 h-3" />
                    Key Matched
                  </span>
                )}
              </div>

              <div className="font-mono text-xs text-slate-200 truncate" title={wallet.address || ""}>
                {wallet.connected && wallet.address
                  ? `${wallet.address.slice(0, 14)}...${wallet.address.slice(-8)}`
                  : "Wallet not connected"}
              </div>

              {userStakeKeyHash && (
                <div className="text-[10px] font-mono text-slate-500 truncate" title={`Stake Key Hash: ${userStakeKeyHash}`}>
                  Stake PKH: {userStakeKeyHash.slice(0, 12)}...{userStakeKeyHash.slice(-8)}
                </div>
              )}

              {/* Balances Breakdown */}
              <div className="border-t border-[#1f2d44] pt-3 space-y-2">
                {isAllClaimed ? (
                  <div className="space-y-2.5">
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>Status:</span>
                      </span>
                      <span className="font-bold text-emerald-400">All Rewards Claimed ✓</span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Claimed GENS:</span>
                      <span className="font-mono font-bold text-emerald-400 text-sm">
                        {formatAmount(totalClaimedGens)} GENS
                      </span>
                    </div>

                    {totalClaimedGensX > 0n && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Claimed GENSX:</span>
                        <span className="font-mono font-bold text-sky-400 text-sm">
                          {formatAmount(totalClaimedGensX)} GENSX
                        </span>
                      </div>
                    )}

                    {totalClaimedLovelace > 0n && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Claimed ADA:</span>
                        <span className="font-mono font-bold text-slate-200">
                          {formatAmount(totalClaimedLovelace)} ADA
                        </span>
                      </div>
                    )}

                    {allClaimedPartnerTokens.length > 0 && (
                      <div className="pt-2 border-t border-[#1f2d44]/60 space-y-1.5">
                        <div className="text-[11px] font-semibold text-slate-400">Claimed Partner Tokens:</div>
                        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                          {allClaimedPartnerTokens.map((t) => (
                            <div key={t.ticker} className="flex items-center justify-between text-[11px] font-mono">
                              <span className="text-slate-400">{t.ticker}:</span>
                              <span className="font-bold text-emerald-300">
                                {formatAmount(t.amount, t.decimals)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Total Claimable GENS:</span>
                      <span className="font-mono font-bold text-emerald-400 text-sm">
                        {wallet.connected ? `${formatAmount(totalUserGens)} GENS` : "—"}
                      </span>
                    </div>

                    {totalUserGensX > 0n && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Total Claimable GENSX:</span>
                        <span className="font-mono font-bold text-sky-400 text-sm">
                          {formatAmount(totalUserGensX)} GENSX
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Total Claimable ADA:</span>
                      <span className="font-mono font-bold text-slate-200">
                        {wallet.connected ? `${formatAmount(totalUserLovelace)} ADA` : "—"}
                      </span>
                    </div>

                    {allUserPartnerTokens.length > 0 && (
                      <div className="pt-2 border-t border-[#1f2d44]/60 space-y-1.5">
                        <div className="text-[11px] font-semibold text-slate-400">Partner Project Tokens:</div>
                        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                          {allUserPartnerTokens.map((t) => (
                            <div key={t.ticker} className="flex items-center justify-between text-[11px] font-mono">
                              <span className="text-slate-400">{t.ticker}:</span>
                              <span className="font-bold text-slate-200">
                                {formatAmount(t.amount, t.decimals)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {wallet.connected && !hasAnyUserRewards && !loading && (
                      <div className="text-center py-2 text-[11px] text-slate-500 italic">
                        No unclaimed rewards allocated for this stake key in the current distribution.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {claimTxHash && (
              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-emerald-200 text-xs space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-white">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Rewards Claimed Successfully!</span>
                </div>
                <div className="text-[11px] font-mono break-all flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                  <span className="text-slate-300">
                    Tx: {claimTxHash.slice(0, 16)}...{claimTxHash.slice(-8)}
                  </span>
                  <a
                    href={`${txExplorerBaseUrl}/${claimTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:underline flex items-center gap-1 font-sans text-xs shrink-0"
                  >
                    <span>View on Cardanoscan</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}

            {claimError && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/50 text-rose-200 text-xs space-y-1">
                <div className="flex items-center gap-2 font-bold text-white">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>Claim Failed</span>
                </div>
                <p className="text-[11px] text-rose-300 break-words">{claimError}</p>
              </div>
            )}

            {/* Architecture Explainer on Claim Execution */}
            <div className="p-3 rounded-xl bg-[#0b0e14] border border-[#1f2d44] text-[11px] text-slate-400 leading-relaxed space-y-1.5">
              <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                <span>Claim Co-Signing Mechanism</span>
              </div>
              <p>
                Genius Yield rewards are held at the sovereign operator address (<code>addr1vy38...</code>). To prevent double-claims, spending requires co-signing by the operator hot key and your wallet.
              </p>
            </div>

            {!wallet.connected ? (
              <button
                type="button"
                onClick={onOpenWallet}
                className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs transition-all shadow-md shadow-emerald-500/20"
              >
                Connect Wallet to View & Claim
              </button>
            ) : preparedTx ? (
              <div className="space-y-2">
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-300 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Transaction Co-Signed by Operator!</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    Tx: {preparedTx.txId.slice(0, 10)}...
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSignAndSubmit}
                  disabled={signing}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-extrabold text-xs transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 animate-pulse disabled:opacity-50 disabled:animate-none"
                >
                  {signing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Submitting to Cardano Network...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Sign in Wallet ({wallet.walletName || "Eternl"}) & Complete Claim</span>
                    </>
                  )}
                </button>
              </div>
            ) : isAllClaimed ? (
              <div className="w-full py-3.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>All Accrued Rewards Claimed</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={handlePrepareClaim}
                disabled={preparing || !hasAnyUserRewards}
                className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs transition-all shadow-md shadow-emerald-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {preparing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>
                      Evaluating Plutus Scripts & Co-Signing... ({elapsedSeconds}s)
                    </span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>
                      {hasAnyUserRewards
                        ? `Claim Accrued Rewards (${formatAmount(totalUserGens)} GENS)`
                        : "No Accrued Rewards"}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
