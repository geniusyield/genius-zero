import React, { useState, useEffect } from "react";
import {
  Vault,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Loader2,
  RefreshCw,
  Wallet,
  CheckCircle2,
  Lock,
  Unlock,
  PlusCircle,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { DEX_CONSTANTS } from "../config/dex";
import {
  fetchUserStakingVaults,
  unstakeVault,
  createStake,
  StakingVault,
} from "../services/staking";

interface StakingViewProps {
  onOpenWallet: () => void;
  onOpenSettings: () => void;
}

export const StakingView: React.FC<StakingViewProps> = ({
  onOpenWallet,
  onOpenSettings,
}) => {
  const { wallet, settings, lucid } = useApp();
  const [vaults, setVaults] = useState<StakingVault[]>([]);
  const [loading, setLoading] = useState(false);
  const [unstakingRef, setUnstakingRef] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showTestStakeModal, setShowTestStakeModal] = useState(false);
  const [testAdaAmount, setTestAdaAmount] = useState("10");
  const [stakingLoading, setStakingLoading] = useState(false);

  const constants = DEX_CONSTANTS[settings.network];

  const loadVaults = async () => {
    if (!lucid) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const walletTokenUnits = Object.keys(wallet.tokenBalances);
      const addressesToScan =
        wallet.usedAddresses && wallet.usedAddresses.length > 0
          ? wallet.usedAddresses
          : wallet.address
          ? [wallet.address]
          : [];

      const res = await fetchUserStakingVaults(
        lucid,
        settings.network,
        walletTokenUnits,
        wallet.pkhs,
        addressesToScan,
        settings.blockfrostApiKey
      );
      setVaults(res);
    } catch (err: any) {
      console.error("Failed to load staking vaults:", err);
      setErrorMsg(err.message || "Failed to load on-chain vaults.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (lucid) {
      loadVaults();
    }
  }, [lucid, wallet.address, settings.network]);

  const handleUnstake = async (v: StakingVault) => {
    if (!lucid) return;
    const refKey = `${v.utxoRef.txHash}#${v.utxoRef.outputIndex}`;
    setUnstakingRef(refKey);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const txHash = await unstakeVault(lucid, v);
      setSuccessMsg(`Unstake transaction submitted successfully! TxHash: ${txHash}`);
      // Refresh vaults after a short delay
      setTimeout(loadVaults, 4000);
    } catch (err: any) {
      console.error("Unstaking error:", err);
      setErrorMsg(err.message || "Failed to submit unstaking transaction.");
    } finally {
      setUnstakingRef(null);
    }
  };

  const handleCreateTestStake = async () => {
    if (!lucid || !wallet.address) return;
    setStakingLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const lovelace = BigInt(Math.floor(parseFloat(testAdaAmount) * 1_000_000));
      const txHash = await createStake(
        lucid,
        settings.network,
        wallet.address,
        lovelace,
        undefined,
        undefined,
        0 // Flexible (unlocked)
      );
      setSuccessMsg(`Test stake created successfully on ${settings.network}! TxHash: ${txHash}`);
      setShowTestStakeModal(false);
      setTimeout(loadVaults, 4000);
    } catch (err: any) {
      console.error("Create stake error:", err);
      setErrorMsg(err.message || "Failed to create test stake.");
    } finally {
      setStakingLoading(false);
    }
  };

  const formatAmount = (amt: bigint) => {
    return (Number(amt) / 1_000_000).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const explorerBaseUrl =
    settings.network === "mainnet"
      ? "https://cardanoscan.io"
      : "https://preprod.cardanoscan.io";

  return (
    <div className="space-y-6">
      {/* Important Operational Notice on Closure & Vault Security */}
      <div className="p-5 rounded-2xl bg-amber-950/30 border border-amber-500/40 text-amber-200 shadow-xl space-y-3">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <h2 className="font-bold text-base text-white">
            Genius Yield Sovereign Unstaking & Multi-Address Protection
          </h2>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          Staked assets in GENS, GENSX, and partner vaults are secured by <strong>immutable Plutus smart contracts on Cardano</strong>.
          Even after centralized company infrastructure halts on <strong>October 15, 2026</strong>, your funds remain safe and can be unstaked at any time.
          Genius Zero inspects all derived addresses in your wallet to solve the legacy Eternl multi-address unstaking issue directly.
        </p>
        <div className="flex flex-wrap items-center gap-4 text-xs pt-1">
          <a
            href={`${explorerBaseUrl}/address/${constants.stakingAddr}`}
            target="_blank"
            rel="noreferrer"
            className="text-amber-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
          >
            Staking Script on Cardanoscan <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Status Notifications */}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-400 hover:text-white text-xs ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-rose-400 hover:text-white text-xs ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="p-5 rounded-2xl bg-[#121824] border border-[#1f2d44] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-semibold">Detected Vaults</span>
            <Vault className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {vaults.length}
          </div>
          <p className="text-[11px] text-slate-500">
            Active on-chain staking vaults found at script address
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-[#121824] border border-[#1f2d44] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-semibold">Your Wallet Vaults</span>
            <Wallet className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-bold text-sky-400 font-mono">
            {vaults.filter((v) => v.isUserOwned).length}
          </div>
          <p className="text-[11px] text-slate-500">
            Vaults matching any payment key in your connected wallet
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-[#121824] border border-[#1f2d44] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-semibold">Contract Security</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-sm font-bold text-emerald-400 flex items-center gap-1.5 pt-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Plutus V1 Script Verified
          </div>
          <p className="text-[11px] text-slate-500">
            Direct script execution via your personal Blockfrost key
          </p>
        </div>
      </div>

      {/* Vaults Table & Controls */}
      <div className="bg-[#121824] border border-[#1f2d44] rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1f2d44]">
          <div>
            <h3 className="font-bold text-sm text-white">Staking Vaults Explorer</h3>
            <p className="text-xs text-slate-400">
              Inspect on-chain vaults and withdraw principal directly
            </p>
          </div>
          <div className="flex items-center gap-2">
            {settings.network === "preprod" && wallet.connected && (
              <button
                onClick={() => setShowTestStakeModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition-colors"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Create Test Stake</span>
              </button>
            )}
            <button
              onClick={loadVaults}
              disabled={loading || !lucid}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#182234] border border-[#1f2d44] text-xs font-semibold text-slate-300 hover:text-white transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {!settings.blockfrostApiKey ? (
          <div className="text-center py-12 space-y-3">
            <p className="text-xs text-slate-400">Please configure your Blockfrost API key to query staking vaults</p>
            <button
              onClick={onOpenSettings}
              className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/20"
            >
              Configure Key
            </button>
          </div>
        ) : !wallet.connected ? (
          <div className="text-center py-12 space-y-3">
            <p className="text-xs text-slate-400">Connect your Cardano wallet to identify your owned staking vaults</p>
            <button
              onClick={onOpenWallet}
              className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs shadow-md shadow-emerald-500/20"
            >
              Connect Wallet
            </button>
          </div>
        ) : vaults.length === 0 ? (
          <div className="text-center py-12 text-xs text-slate-500 italic">
            {loading ? "Scanning on-chain staking address..." : "No active vaults found at staking script."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-[#1f2d44] text-[10px] text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Ownership</th>
                  <th className="py-2.5 px-3">Project</th>
                  <th className="py-2.5 px-3">Staked Principal</th>
                  <th className="py-2.5 px-3">Deposit ADA</th>
                  <th className="py-2.5 px-3">Lock Status</th>
                  <th className="py-2.5 px-3">Owner PKH</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1f2d44]/50">
                {vaults.map((v, idx) => {
                  const refKey = `${v.utxoRef.txHash}#${v.utxoRef.outputIndex}`;
                  const isCurrentUnstaking = unstakingRef === refKey;

                  return (
                    <tr key={`${refKey}-${idx}`} className="hover:bg-[#182234]/50 transition-colors">
                      <td className="py-3 px-3">
                        {v.isUserOwned ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Your Vault
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400">
                            Community
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-bold text-white">
                        {v.project}
                      </td>
                      <td className="py-3 px-3 text-slate-200">
                        {formatAmount(v.stakedAmount)} <span className="text-slate-400">{v.project}</span>
                      </td>
                      <td className="py-3 px-3 text-slate-400">
                        {(Number(v.depositLovelace) / 1_000_000).toFixed(2)} ADA
                      </td>
                      <td className="py-3 px-3">
                        {v.lockedUntilMs ? (
                          v.isUnlocked ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px]">
                              <Unlock className="w-3 h-3" /> Unlocked
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-400 text-[11px]" title={`Locked until ${new Date(v.lockedUntilMs).toLocaleString()}`}>
                              <Lock className="w-3 h-3" /> Locked
                            </span>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sky-400 text-[11px]">
                            <Unlock className="w-3 h-3" /> Flexible
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">
                        {v.ownerPkh ? `${v.ownerPkh.slice(0, 10)}...` : "—"}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {v.isUserOwned ? (
                          <button
                            type="button"
                            onClick={() => handleUnstake(v)}
                            disabled={isCurrentUnstaking || !v.isUnlocked}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-xs font-semibold transition-all disabled:opacity-50"
                          >
                            {isCurrentUnstaking ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Unlock className="w-3.5 h-3.5" />
                            )}
                            <span>Unstake</span>
                          </button>
                        ) : (
                          <span className="text-slate-600 text-[11px] italic">Read-only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Preprod Test Staking Modal */}
      {showTestStakeModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121824] border border-[#1f2d44] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="font-bold text-base text-white">Create Test Stake on Preprod</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Deposit testnet ADA to the staking script to simulate a user stake. Once deposited, you can switch address indices in Eternl to test multi-address unstaking.
            </p>
            <div className="space-y-2">
              <label className="text-xs text-slate-300 font-medium">Staked ADA Amount</label>
              <input
                type="number"
                min="5"
                value={testAdaAmount}
                onChange={(e) => setTestAdaAmount(e.target.value)}
                className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-amber-400"
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowTestStakeModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateTestStake}
                disabled={stakingLoading}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all disabled:opacity-50"
              >
                {stakingLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Stake on Preprod</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
