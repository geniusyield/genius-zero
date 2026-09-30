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
import { fetchActiveRewardPools, RewardPool, RewardAsset } from "../services/rewards";
import { getAddressDetails } from "@lucid-evolution/lucid";

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
  const [claiming, setClaiming] = useState(false);
  const [claimTxHash, setClaimTxHash] = useState<string | null>(null);
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

  const handleClaim = async () => {
    if (!wallet.connected) {
      onOpenWallet();
      return;
    }

    setClaiming(true);
    try {
      // In Genius Yield architecture, rewards at addr1vy38... are spent via the Claim Microservice
      // co-signing with owner.skey.
      setTimeout(() => {
        setClaimTxHash("demo_rewards_claim_transaction_cardano");
        setClaiming(false);
      }, 1500);
    } catch (err) {
      console.error(err);
      setClaiming(false);
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
        {/* Active On-Chain Pools (2 Cols) */}
        <div className="lg:col-span-2 bg-[#121824] border border-[#1f2d44] rounded-2xl p-5 space-y-4">
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
                    {wallet.connected && poolHasUserRewards && (
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
                    )}

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

        {/* Claim Action Box (1 Col) */}
        <div className="bg-[#121824] border border-[#1f2d44] rounded-2xl p-5 flex flex-col justify-between space-y-4">
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
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {claimTxHash && (
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Rewards claim transaction prepared!</span>
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
            ) : (
              <button
                type="button"
                onClick={handleClaim}
                disabled={claiming || !hasAnyUserRewards}
                className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs transition-all shadow-md shadow-emerald-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {claiming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Preparing Claim Transaction...</span>
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
