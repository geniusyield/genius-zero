import React, { useState, useEffect, useRef } from "react";
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
  Database,
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { DEX_CONSTANTS } from "../config/dex";
import {
  fetchUserStakingVaults,
  unstakeVault,
  createStake,
  StakingVault,
} from "../services/staking";
import { FetchProgress } from "../types";
import { ProgressBar } from "./ProgressBar";

interface StakingViewProps {
  onOpenWallet: () => void;
  onOpenSettings: () => void;
}

const SPENT_VAULTS_KEY = "genius_zero_spent_vaults";

function getStoredSpentVaults(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SPENT_VAULTS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function addStoredSpentVault(ref: string) {
  if (typeof window === "undefined") return;
  try {
    const set = getStoredSpentVaults();
    set.add(ref);
    sessionStorage.setItem(SPENT_VAULTS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export const StakingView: React.FC<StakingViewProps> = ({
  onOpenWallet,
  onOpenSettings,
}) => {
  const { wallet, settings, lucid } = useApp();
  const [vaults, setVaults] = useState<StakingVault[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const [unstakingRef, setUnstakingRef] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [latestTxHash, setLatestTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showTestStakeModal, setShowTestStakeModal] = useState(false);
  const [testAdaAmount, setTestAdaAmount] = useState("10");
  const [stakingLoading, setStakingLoading] = useState(false);

  // Search, Filter & Pagination state
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<"ALL" | "GENS" | "GENSX" | "ADA" | "MY">("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const constants = DEX_CONSTANTS[settings.network];

  const cancelLoadVaults = () => {
    abortRef.current.aborted = true;
    setLoading(false);
    setProgress(null);
  };

  const loadVaults = async () => {
    if (!lucid) return;
    setLoading(true);
    setProgress(null);
    setErrorMsg(null);
    abortRef.current = { aborted: false };

    try {
      const walletTokenUnits = Object.keys(wallet.tokenBalances);
      const addressesToScan =
        wallet.usedAddresses && wallet.usedAddresses.length > 0
          ? wallet.usedAddresses
          : wallet.address
          ? [wallet.address]
          : [];

      const spentRefs = getStoredSpentVaults();
      const res = await fetchUserStakingVaults(
        lucid,
        settings.network,
        walletTokenUnits,
        wallet.pkhs,
        addressesToScan,
        settings.blockfrostApiKey,
        (p) => setProgress(p),
        {
          abortSignal: abortRef.current,
          rewardAddress: wallet.rewardAddress,
          spentRefs,
        }
      );
      if (!abortRef.current.aborted) {
        const activeVaults = res.filter(
          (v) => !spentRefs.has(`${v.utxoRef.txHash}#${v.utxoRef.outputIndex}`)
        );
        setVaults(activeVaults);
      }
    } catch (err: any) {
      console.error("Failed to load staking vaults:", err);
      setErrorMsg(err.message || "Failed to load on-chain vaults.");
    } finally {
      setLoading(false);
      setProgress(null);
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
    setLatestTxHash(null);

    try {
      const txHash = await unstakeVault(lucid, v);

      // 1. Persist spent vault ref in session storage so refresh won't resurrect it while Blockfrost indexes
      addStoredSpentVault(refKey);

      // 2. Optimistic UI update: remove vault from React state immediately
      setVaults((prev) =>
        prev.filter(
          (item) =>
            !(
              item.utxoRef.txHash === v.utxoRef.txHash &&
              item.utxoRef.outputIndex === v.utxoRef.outputIndex
            )
        )
      );

      // 3. Set confirmation and explorer tracking
      setSuccessMsg(`Unstake transaction submitted successfully! TxHash: ${txHash}`);
      setLatestTxHash(txHash);

      // 4. Background re-check after 45s once Cardano block & Blockfrost DBSync have processed
      setTimeout(() => {
        loadVaults();
      }, 45_000);
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

  const gensCount = vaults.filter((v) => v.project === "GENS" || v.project === "tGENS").length;
  const gensxCount = vaults.filter((v) => v.project === "GENSX").length;
  const adaCount = vaults.filter((v) => v.project === "ADA" || v.project === "tADA").length;
  const myCount = vaults.filter((v) => v.isUserOwned).length;

  const filteredVaults = vaults.filter((v) => {
    if (projectFilter === "MY" && !v.isUserOwned) return false;
    if (projectFilter === "GENS" && v.project !== "GENS" && v.project !== "tGENS") return false;
    if (projectFilter === "GENSX" && v.project !== "GENSX") return false;
    if (projectFilter === "ADA" && v.project !== "ADA" && v.project !== "tADA") return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const refStr = `${v.utxoRef.txHash}#${v.utxoRef.outputIndex}`.toLowerCase();
      const pkhStr = v.ownerPkh?.toLowerCase() || "";
      const projStr = v.project.toLowerCase();
      return refStr.includes(q) || pkhStr.includes(q) || projStr.includes(q);
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredVaults.length / pageSize));
  const validPage = Math.min(currentPage, totalPages);
  const paginatedVaults = filteredVaults.slice((validPage - 1) * pageSize, validPage * pageSize);

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
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <p className="font-semibold text-white">Unstake Transaction Submitted</p>
              <p className="text-emerald-300/90 text-[11px] mt-0.5">
                The vault has been withdrawn and optimistically removed from your list. Funds will appear in your wallet once minted into a block.
              </p>
              {latestTxHash && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-slate-400 text-[11px]">Track on Explorer:</span>
                  <a
                    href={`${explorerBaseUrl}/transaction/${latestTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:text-emerald-200 underline font-mono text-[11px] flex items-center gap-1"
                  >
                    {latestTxHash.slice(0, 16)}...{latestTxHash.slice(-8)}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              setSuccessMsg(null);
              setLatestTxHash(null);
            }}
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
            {vaults.length.toLocaleString()}
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
              Inspect all on-chain vaults ({vaults.length.toLocaleString()} total) and withdraw principal directly
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              onClick={() => loadVaults()}
              disabled={loading || !lucid}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#182234] border border-[#1f2d44] text-xs font-semibold text-slate-300 hover:text-white transition-colors disabled:opacity-50"
              title="Refresh all on-chain vaults at the staking contract"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading && !progress ? "animate-spin text-emerald-400" : ""}`} />
              <span>Refresh Vaults</span>
            </button>
          </div>
        </div>

        {/* Live Progress Bar Indicator */}
        {loading && progress && (
          <div className="pt-1">
            <ProgressBar
              progress={progress}
              onCancel={cancelLoadVaults}
            />
          </div>
        )}

        {/* Search & Project Filters */}
        {vaults.length > 0 && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
            {/* Project Filter Pills */}
            <div className="flex items-center gap-1.5 text-xs overflow-x-auto pb-1 sm:pb-0 flex-nowrap sm:flex-wrap">
              <button
                type="button"
                onClick={() => { setProjectFilter("ALL"); setCurrentPage(1); }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  projectFilter === "ALL"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    : "bg-[#182234] text-slate-400 border border-[#1f2d44] hover:text-white"
                }`}
              >
                All ({vaults.length.toLocaleString()})
              </button>
              <button
                type="button"
                onClick={() => { setProjectFilter("GENS"); setCurrentPage(1); }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  projectFilter === "GENS"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    : "bg-[#182234] text-slate-400 border border-[#1f2d44] hover:text-white"
                }`}
              >
                GENS ({gensCount.toLocaleString()})
              </button>
              <button
                type="button"
                onClick={() => { setProjectFilter("GENSX"); setCurrentPage(1); }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  projectFilter === "GENSX"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    : "bg-[#182234] text-slate-400 border border-[#1f2d44] hover:text-white"
                }`}
              >
                GENSX ({gensxCount.toLocaleString()})
              </button>
              {adaCount > 0 && (
                <button
                  type="button"
                  onClick={() => { setProjectFilter("ADA"); setCurrentPage(1); }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    projectFilter === "ADA"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-[#182234] text-slate-400 border border-[#1f2d44] hover:text-white"
                  }`}
                >
                  ADA ({adaCount.toLocaleString()})
                </button>
              )}
              <button
                type="button"
                onClick={() => { setProjectFilter("MY"); setCurrentPage(1); }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  projectFilter === "MY"
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                    : "bg-[#182234] text-slate-400 border border-[#1f2d44] hover:text-white"
                }`}
              >
                My Vaults ({myCount})
              </button>
            </div>

            {/* Search Box */}
            <div className="relative w-full sm:w-auto sm:min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search by PKH, TxHash..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors font-mono"
              />
            </div>
          </div>
        )}

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
        ) : filteredVaults.length === 0 ? (
          <div className="text-center py-12 text-xs text-slate-500 italic">
            {loading
              ? progress
                ? `Scanning on-chain vaults: ${progress.current} / ${progress.total}...`
                : "Scanning on-chain staking address..."
              : vaults.length > 0
              ? "No vaults match your current filter or search criteria."
              : "No active vaults found at staking script."}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Desktop Table View (Hidden on Mobile) */}
            <div className="hidden md:block overflow-x-auto">
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
                  {paginatedVaults.map((v, idx) => {
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

            {/* Mobile Card List (Hidden on Desktop) */}
            <div className="md:hidden space-y-3">
              {paginatedVaults.map((v, idx) => {
                const refKey = `${v.utxoRef.txHash}#${v.utxoRef.outputIndex}`;
                const isCurrentUnstaking = unstakingRef === refKey;

                return (
                  <div
                    key={`mobile-${refKey}-${idx}`}
                    className="p-3.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-2.5"
                  >
                    {/* Top Row: Ownership, Project, Lock Status */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">{v.project}</span>
                        {v.isUserOwned ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Your Vault
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400">
                            Community
                          </span>
                        )}
                      </div>

                      <div>
                        {v.lockedUntilMs ? (
                          v.isUnlocked ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-mono">
                              <Unlock className="w-3 h-3" /> Unlocked
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-400 text-xs font-mono" title={`Locked until ${new Date(v.lockedUntilMs).toLocaleString()}`}>
                              <Lock className="w-3 h-3" /> Locked
                            </span>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sky-400 text-xs font-mono">
                            <Unlock className="w-3 h-3" /> Flexible
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-[#121824] p-2.5 rounded-lg border border-[#1a2332]">
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase">Staked Principal</div>
                        <div className="font-bold text-white text-sm">
                          {formatAmount(v.stakedAmount)} <span className="text-slate-400 text-xs">{v.project}</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase">Deposit ADA</div>
                        <div className="font-semibold text-slate-300">
                          {(Number(v.depositLovelace) / 1_000_000).toFixed(2)} ADA
                        </div>
                      </div>
                    </div>

                    {/* PKH / Details */}
                    {v.ownerPkh && (
                      <div className="text-[10px] font-mono text-slate-500 truncate">
                        Owner: {v.ownerPkh.slice(0, 14)}...{v.ownerPkh.slice(-8)}
                      </div>
                    )}

                    {/* Action button if owned */}
                    {v.isUserOwned && (
                      <button
                        type="button"
                        onClick={() => handleUnstake(v)}
                        disabled={isCurrentUnstaking || !v.isUnlocked}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-slate-950 font-bold text-xs transition-all shadow-md shadow-sky-500/20 disabled:opacity-50"
                      >
                        {isCurrentUnstaking ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Submitting Unstake...</span>
                          </>
                        ) : (
                          <>
                            <Unlock className="w-3.5 h-3.5" />
                            <span>Unstake {formatAmount(v.stakedAmount)} {v.project}</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pagination Controls */}
            {filteredVaults.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#1f2d44] text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <span>
                    Showing{" "}
                    <strong className="text-white font-mono">
                      {(validPage - 1) * pageSize + 1}
                    </strong>{" "}
                    to{" "}
                    <strong className="text-white font-mono">
                      {Math.min(validPage * pageSize, filteredVaults.length)}
                    </strong>{" "}
                    of{" "}
                    <strong className="text-white font-mono">
                      {filteredVaults.length.toLocaleString()}
                    </strong>{" "}
                    vaults
                  </span>
                  <span className="text-slate-600">|</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px]">Rows:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="bg-[#182234] border border-[#1f2d44] rounded px-1.5 py-0.5 text-white text-[11px] focus:outline-none"
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={validPage <= 1}
                    className="p-1 rounded bg-[#182234] border border-[#1f2d44] hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    title="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-mono text-xs text-slate-300">
                    Page <strong className="text-white">{validPage}</strong> of{" "}
                    <strong className="text-white">{totalPages}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={validPage >= totalPages}
                    className="p-1 rounded bg-[#182234] border border-[#1f2d44] hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    title="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
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
