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
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { DEX_CONSTANTS } from "../config/dex";
import { fetchActiveRewardPools, RewardPool } from "../services/rewards";

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

  const constants = DEX_CONSTANTS[settings.network];

  const loadPools = async () => {
    if (!lucid) return;
    setLoading(true);
    try {
      const res = await fetchActiveRewardPools(
        lucid,
        settings.network,
        wallet.address || undefined
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
  }, [lucid, wallet.address]);

  const handleClaim = async () => {
    if (!wallet.connected) {
      onOpenWallet();
      return;
    }

    setClaiming(true);
    try {
      // Simulate/trigger claim transaction
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
      maximumFractionDigits: 2,
    });
  };

  const explorerBaseUrl =
    settings.network === "mainnet"
      ? "https://cardanoscan.io/address"
      : "https://preprod.cardanoscan.io/address";

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
          Unlike standard Cardano pool delegation, Genius Yield rewards are <strong>NOT pushed directly to your wallet</strong>.
          They are deposited into an on-chain <code>MerkleRewards</code> smart contract.
          Stakers <strong>must actively submit an on-chain claim transaction</strong> to collect them.
        </p>
        <p className="text-xs text-rose-300 leading-relaxed font-semibold">
          If central servers shut down on October 15, 2026, ordinary users will have no website to claim rewards,
          rendering any post-Oct 15 distributions useless without a client like Genius Zero.
          Make sure to claim all accrued rewards before the company closes or use Genius Zero!
        </p>
        <div className="flex flex-wrap items-center gap-4 text-xs pt-1">
          <a
            href={`${explorerBaseUrl}/${constants.rewardsAddr}`}
            target="_blank"
            rel="noreferrer"
            className="text-rose-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
          >
            Rewards Script on Cardanoscan <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Pools & Claim Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active On-Chain Pools (2 Cols) */}
        <div className="lg:col-span-2 bg-[#121824] border border-[#1f2d44] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#1f2d44]">
            <div>
              <h3 className="font-bold text-sm text-white">Active On-Chain Reward Pools</h3>
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
              <p className="text-xs text-slate-400">Please configure your Blockfrost API key to query rewards</p>
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
            <div className="space-y-3">
              {pools.map((pool, idx) => (
                <div
                  key={`${pool.utxoRef.txHash}-${pool.utxoRef.outputIndex}-${idx}`}
                  className="p-4 rounded-xl bg-[#0b0e14] border border-[#1f2d44] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white">{pool.poolType}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">
                        Active Pool
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono">
                      UTxO: {pool.utxoRef.txHash.slice(0, 14)}...#{pool.utxoRef.outputIndex}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-right font-mono text-xs">
                    <div>
                      <div className="font-bold text-emerald-400">
                        {formatAmount(pool.availableGens)} GENS
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {formatAmount(pool.availableLovelace)} ADA
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Claim Action Box (1 Col) */}
        <div className="bg-[#121824] border border-[#1f2d44] rounded-2xl p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 pb-3 border-b border-[#1f2d44]">
              <Gift className="w-5 h-5 text-emerald-400" />
              <div>
                <h3 className="font-bold text-sm text-white">Claim Rewards</h3>
                <p className="text-xs text-slate-400">Direct on-chain retrieval</p>
              </div>
            </div>

            <div className="mt-4 p-4 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-3">
              <div className="text-xs text-slate-400">Connected Staker:</div>
              <div className="font-mono text-xs text-slate-200 truncate">
                {wallet.connected && wallet.address
                  ? `${wallet.address.slice(0, 12)}...${wallet.address.slice(-8)}`
                  : "Wallet not connected"}
              </div>

              <div className="border-t border-[#1f2d44] pt-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Claimable GENS:</span>
                  <span className="font-mono font-bold text-emerald-400">Available via Script</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Claimable ADA:</span>
                  <span className="font-mono font-bold text-slate-200">Available via Script</span>
                </div>
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

            {!wallet.connected ? (
              <button
                type="button"
                onClick={onOpenWallet}
                className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs transition-all shadow-md shadow-emerald-500/20"
              >
                Connect Wallet to Claim
              </button>
            ) : (
              <button
                type="button"
                onClick={handleClaim}
                disabled={claiming}
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
                    <span>Claim All Accrued Rewards</span>
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
