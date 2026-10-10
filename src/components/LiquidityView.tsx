import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Layers,
  Search,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  Filter,
  Coins,
  ShieldAlert,
  Loader2,
  Wallet,
  ArrowRightLeft,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Sparkles,
  Trash2,
  AlertTriangle,
  X,
  CheckCircle2,
  PlusCircle,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { DEX_CONSTANTS } from "../config/dex";
import { LiquidityVault, FetchProgress, TokenInfo } from "../types";
import { fetchAllLiquidityVaults, getVaultAdaReserve, formatNumericPrice } from "../services/liquidity";
import { cancelLiquidityVault } from "../contracts/slv";
import { calculateVaultOraclePrices, fetchLiveOraclePrice } from "../services/oracle";
import { TradeVaultModal } from "./TradeVaultModal";
import { CreateVaultModal } from "./CreateVaultModal";

const SUPPORTED_ORACLES: Record<string, string> = {
  mainnet: "24207cde7ca2dc27431ff87b5324ab5b0d8c113f608f5143ff50a6bae60373c0",
  preprod: "b953f42e6d44d217ed8ae94a20f3b448ca45757031dfdb2b879ae389cac68e29",
};

interface LiquidityViewProps {
  onOpenWallet: () => void;
  onOpenSettings: () => void;
}

export const LiquidityView: React.FC<LiquidityViewProps> = ({
  onOpenWallet,
  onOpenSettings,
}) => {
  const { wallet, settings, lucid } = useApp();
  const [vaults, setVaults] = useState<LiquidityVault[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Cancellation State
  const [cancellingVault, setCancellingVault] = useState<LiquidityVault | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelTxHash, setCancelTxHash] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Trading & Creation Modal States
  const [tradingVault, setTradingVault] = useState<LiquidityVault | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Filters
  const [viewFilter, setViewFilter] = useState<"ALL" | "MY">("ALL");
  const [selectedPair, setSelectedPair] = useState<string>("ALL");
  const [selectedPricingType, setSelectedPricingType] = useState<"ALL" | "fixed" | "delta_oracle" | "oracle_range">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [oraclePrices, setOraclePrices] = useState<Record<string, { price: number; timestamp: number }>>({});

  const handleConfirmCancel = async () => {
    if (!lucid || !cancellingVault) return;
    setIsCancelling(true);
    setCancelError(null);
    try {
      const txHash = await cancelLiquidityVault(lucid, cancellingVault);
      setCancelTxHash(txHash);
      // Optimistically remove the cancelled vault from the list:
      setVaults((prev) =>
        prev.filter(
          (v) =>
            v.utxoRef.txHash !== cancellingVault.utxoRef.txHash ||
            v.utxoRef.outputIndex !== cancellingVault.utxoRef.outputIndex
        )
      );
    } catch (err: any) {
      console.error("Failed to cancel vault:", err);
      setCancelError(err?.message || "Failed to submit cancellation transaction to Cardano.");
    } finally {
      setIsCancelling(false);
    }
  };

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const constants = DEX_CONSTANTS[settings.network];

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const loadVaults = async () => {
    if (!lucid) return;
    if (!constants.slvScriptHash) {
      setVaults([]);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setProgress(null);

    try {
      const addressesToScan =
        wallet.usedAddresses && wallet.usedAddresses.length > 0
          ? wallet.usedAddresses
          : wallet.address
          ? [wallet.address]
          : [];

      const res = await fetchAllLiquidityVaults(
        lucid,
        settings.network,
        settings.customTokens,
        addressesToScan,
        wallet.pkhs || (wallet.pkh ? [wallet.pkh] : []),
        (p) => setProgress(p)
      );

      setVaults(res);
    } catch (err: any) {
      console.error("Error loading liquidity vaults:", err);
      setErrorMsg(err.message || "Failed to load Smart Liquidity Vaults from Cardano.");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  useEffect(() => {
    if (lucid) {
      loadVaults();
    }
  }, [lucid, settings.network, wallet.address]);

  // Fetch and refresh live oracle prices for pairs present in active oracle vaults
  useEffect(() => {
    const oracleVaults = vaults.filter(
      (v) => v.pricingType === "delta_oracle" || v.pricingType === "oracle_range"
    );
    if (oracleVaults.length === 0) return;

    const pairsToFetch = new Map<string, { base: TokenInfo; quote: TokenInfo }>();
    for (const v of oracleVaults) {
      if (!pairsToFetch.has(v.canonicalPair.pairKey)) {
        pairsToFetch.set(v.canonicalPair.pairKey, {
          base: v.canonicalPair.base,
          quote: v.canonicalPair.quote,
        });
      }
    }

    let isMounted = true;
    const fetchPrices = async () => {
      const updates: Record<string, { price: number; timestamp: number }> = {};
      await Promise.all(
        Array.from(pairsToFetch.entries()).map(async ([pairKey, { base, quote }]) => {
          try {
            const price = await fetchLiveOraclePrice(settings.network, base, quote);
            if (price && price > 0) {
              updates[pairKey] = { price, timestamp: Date.now() };
            }
          } catch {
            // ignore
          }
        })
      );
      if (isMounted && Object.keys(updates).length > 0) {
        setOraclePrices((prev) => ({ ...prev, ...updates }));
      }
    };

    fetchPrices();
    const intervalId = setInterval(fetchPrices, 30_000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [vaults, settings.network]);

  // Distinct canonical pairs across all vaults
  const distinctPairs = useMemo(() => {
    const pairMap = new Map<string, number>();
    for (const v of vaults) {
      const pairKey = v.canonicalPair.pairKey;
      pairMap.set(pairKey, (pairMap.get(pairKey) || 0) + 1);
    }
    return Array.from(pairMap.entries()).sort((a, b) => b[1] - a[1]);
  }, [vaults]);

  // Pricing type counts
  const oracleDeltaCount = useMemo(
    () => vaults.filter((v) => v.pricingType === "delta_oracle" || v.pricingType === "oracle_range").length,
    [vaults]
  );
  const fixedPriceCount = useMemo(
    () => vaults.filter((v) => v.pricingType === "fixed").length,
    [vaults]
  );

  // Aggregate TVL & Metrics
  const metrics = useMemo(() => {
    let totalAdaLovelace = 0n;
    let totalGens = 0n;
    let userVaultCount = 0;

    for (const v of vaults) {
      if (v.isUserVault) userVaultCount++;
      totalAdaLovelace += getVaultAdaReserve(v);

      if (v.tokenA.symbol === "GENS") totalGens += v.amountA;
      if (v.tokenB.symbol === "GENS") totalGens += v.amountB;
    }

    return {
      totalVaults: vaults.length,
      userVaultCount,
      totalAda: Number(totalAdaLovelace) / 1_000_000,
      totalGens: Number(totalGens) / 1_000_000,
    };
  }, [vaults]);

  // Filtered vaults
  const filteredVaults = useMemo(() => {
    return vaults.filter((v) => {
      // 1. My Vaults filter
      if (viewFilter === "MY" && !v.isUserVault) return false;

      // 2. Pair filter
      if (selectedPair !== "ALL") {
        if (v.canonicalPair.pairKey !== selectedPair) return false;
      }

      // 3. Pricing type filter
      if (selectedPricingType !== "ALL") {
        if (selectedPricingType === "delta_oracle" || selectedPricingType === "oracle_range") {
          if (v.pricingType !== "delta_oracle" && v.pricingType !== "oracle_range") return false;
        } else if (v.pricingType !== selectedPricingType) {
          return false;
        }
      }

      // 4. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchSymbolA = v.tokenA.symbol.toLowerCase().includes(q);
        const matchSymbolB = v.tokenB.symbol.toLowerCase().includes(q);
        const matchNameA = v.tokenA.name.toLowerCase().includes(q);
        const matchNameB = v.tokenB.name.toLowerCase().includes(q);
        const matchPair = v.canonicalPair.pairKey.toLowerCase().includes(q);
        const matchOwner = v.ownerKey.toLowerCase().includes(q);
        const matchTx = v.utxoRef.txHash.toLowerCase().includes(q);
        if (
          !matchSymbolA &&
          !matchSymbolB &&
          !matchNameA &&
          !matchNameB &&
          !matchPair &&
          !matchOwner &&
          !matchTx
        ) {
          return false;
        }
      }

      return true;
    });
  }, [vaults, viewFilter, selectedPair, selectedPricingType, searchQuery]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredVaults.length / pageSize));
  const paginatedVaults = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredVaults.slice(start, start + pageSize);
  }, [filteredVaults, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [viewFilter, selectedPair, selectedPricingType, searchQuery, pageSize]);

  return (
    <div className="space-y-6">
      {/* Top Banner / Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-3xl bg-gradient-to-r from-[#131b2e] via-[#101726] to-[#121624] border border-[#1f2d44] shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                Smart Liquidity Vaults (SLV)
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-700/50">
                  DEX v2 Two-Way Orders
                </span>
              </h1>
              <p className="text-xs md:text-sm text-slate-400">
                Explore on-chain concentrated liquidity & fixed-price automated market maker vaults on Cardano.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (!wallet.connected) {
                onOpenWallet();
              } else {
                setIsCreateModalOpen(true);
              }
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-bold transition-all shadow-md shadow-sky-500/20 active:scale-[0.99]"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Create Liquidity Vault</span>
          </button>

          <button
            onClick={loadVaults}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1a2333] hover:bg-[#232f45] text-slate-200 border border-[#2d3d5a] text-xs font-bold transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-purple-400" : ""}`} />
            <span>{loading ? "Refreshing..." : "Refresh Vaults"}</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-[#121824] border border-[#1f2d44] shadow-sm">
          <div className="text-slate-400 text-xs font-medium flex items-center gap-1.5 mb-1">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span>Total Active Vaults</span>
          </div>
          <div className="text-xl md:text-2xl font-black text-white">
            {metrics.totalVaults}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            On Cardano {settings.network}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[#121824] border border-[#1f2d44] shadow-sm">
          <div className="text-slate-400 text-xs font-medium flex items-center gap-1.5 mb-1">
            <Coins className="w-3.5 h-3.5 text-emerald-400" />
            <span>Total ADA Locked</span>
          </div>
          <div className="text-xl md:text-2xl font-black text-emerald-400">
            {metrics.totalAda.toLocaleString(undefined, { maximumFractionDigits: 0 })} ₳
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Across all active liquidity vaults
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[#121824] border border-[#1f2d44] shadow-sm">
          <div className="text-slate-400 text-xs font-medium flex items-center gap-1.5 mb-1">
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span>Total GENS Locked</span>
          </div>
          <div className="text-xl md:text-2xl font-black text-sky-400">
            {metrics.totalGens.toLocaleString(undefined, { maximumFractionDigits: 0 })} GENS
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Committed liquidity
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[#121824] border border-[#1f2d44] shadow-sm">
          <div className="text-slate-400 text-xs font-medium flex items-center gap-1.5 mb-1">
            <Wallet className="w-3.5 h-3.5 text-amber-400" />
            <span>My Active Vaults</span>
          </div>
          <div className="text-xl md:text-2xl font-black text-amber-400">
            {metrics.userVaultCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {wallet.connected ? "Owned by connected wallet" : "Connect wallet to view"}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-2xl bg-[#121824] border border-[#1f2d44] space-y-4 shadow-sm">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          {/* View Filter (All vs My Vaults) */}
          <div className="flex items-center gap-1 bg-[#0b0e14] p-1 rounded-xl border border-[#1f2d44] shrink-0">
            <button
              onClick={() => setViewFilter("ALL")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewFilter === "ALL"
                  ? "bg-[#1f2d44] text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              All Vaults ({vaults.length})
            </button>
            <button
              onClick={() => setViewFilter("MY")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewFilter === "MY"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>My Vaults ({metrics.userVaultCount})</span>
            </button>
          </div>

          {/* Pricing Type Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 flex-nowrap">
            <button
              onClick={() => setSelectedPricingType("ALL")}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedPricingType === "ALL"
                  ? "bg-purple-900/40 text-purple-300 border border-purple-700/50"
                  : "bg-[#182234] text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              All Types ({vaults.length})
            </button>
            <button
              onClick={() => setSelectedPricingType("delta_oracle")}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedPricingType === "delta_oracle" || selectedPricingType === "oracle_range"
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-700/50"
                  : "bg-[#182234] text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              Oracle Dynamic ({oracleDeltaCount})
            </button>
            <button
              onClick={() => setSelectedPricingType("fixed")}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedPricingType === "fixed"
                  ? "bg-sky-950 text-sky-300 border border-sky-700/50"
                  : "bg-[#182234] text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              Fixed Price ({fixedPriceCount})
            </button>
          </div>

          {/* Pair Select & Search Input */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 md:max-w-md">
            <select
              value={selectedPair}
              onChange={(e) => setSelectedPair(e.target.value)}
              className="bg-[#0b0e14] border border-[#1f2d44] text-slate-200 text-xs rounded-xl px-3 py-2 outline-none focus:border-purple-500 transition-colors"
            >
              <option value="ALL">All Trading Pairs ({distinctPairs.length})</option>
              {distinctPairs.map(([pair, count]) => (
                <option key={pair} value={pair}>
                  {pair} ({count})
                </option>
              ))}
            </select>

            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search token, owner, or UTxO..."
                className="w-full bg-[#0b0e14] border border-[#1f2d44] text-slate-100 text-xs rounded-xl pl-8 pr-3 py-2 outline-none focus:border-purple-500 transition-colors placeholder:text-slate-400"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {errorMsg && (
        <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-800/40 text-rose-200 text-xs flex items-center gap-3">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Progress / Loading Indicator */}
      {loading && (
        <div className="p-6 rounded-2xl bg-[#121824] border border-[#1f2d44] text-center space-y-3">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin mx-auto" />
          <div className="text-sm font-semibold text-slate-200">
            {progress?.stage || "Reading Smart Liquidity Vaults from Cardano..."}
          </div>
          {progress && progress.total > 0 && (
            <div className="w-full max-w-md mx-auto bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-purple-500 h-full transition-all duration-300"
                style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* No Vaults Found */}
      {!loading && filteredVaults.length === 0 && (
        <div className="p-12 rounded-3xl bg-[#121824] border border-[#1f2d44] text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center mx-auto border border-purple-500/20">
            <Layers className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-100">No Liquidity Vaults Found</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              {viewFilter === "MY"
                ? "No liquidity vaults belonging to your connected wallet were found. Make sure the wallet that created the vault is connected."
                : "No vaults match your selected pair, pricing filter, or search keywords."}
            </p>
          </div>
          {viewFilter === "MY" && !wallet.connected && (
            <button
              onClick={onOpenWallet}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors inline-flex items-center gap-2 shadow-lg shadow-purple-600/20"
            >
              <Wallet className="w-4 h-4" />
              <span>Connect Wallet</span>
            </button>
          )}
        </div>
      )}

      {/* Vaults Grid */}
      {!loading && paginatedVaults.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paginatedVaults.map((vault) => {
            const utxoId = `${vault.utxoRef.txHash}#${vault.utxoRef.outputIndex}`;
            const { base, quote, isReversed } = vault.canonicalPair;
            const baseAmountFormatted = isReversed ? vault.formattedAmountB : vault.formattedAmountA;
            const quoteAmountFormatted = isReversed ? vault.formattedAmountA : vault.formattedAmountB;

            const isDynamicOracle =
              vault.pricingType === "delta_oracle" || vault.pricingType === "oracle_range";
            const expectedOracleKey = SUPPORTED_ORACLES[settings.network.toLowerCase()]?.toLowerCase();
            const vaultOracleKey = vault.oracleDelta?.oracleKey?.toLowerCase();
            const isLegacyOracle = isDynamicOracle && !!vaultOracleKey && vaultOracleKey !== expectedOracleKey;

            return (
              <div
                key={utxoId}
                className={`p-5 rounded-3xl bg-[#121824] border transition-all hover:border-slate-600 flex flex-col justify-between space-y-4 shadow-md ${
                  vault.isUserVault
                    ? "border-amber-500/50 shadow-amber-500/5 ring-1 ring-amber-500/30"
                    : "border-[#1f2d44]"
                }`}
              >
                {/* Card Header: Pair & Badges */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    {/* Token Icons: Base then Quote */}
                    <div className="flex -space-x-2 shrink-0">
                      {base.icon ? (
                        <img
                          src={base.icon}
                          alt={base.symbol}
                          className="w-7 h-7 rounded-full border-2 border-[#121824] bg-slate-800 object-cover"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full border-2 border-[#121824] bg-purple-600 text-white flex items-center justify-center text-[10px] font-bold">
                          {base.symbol.slice(0, 3)}
                        </div>
                      )}
                      {quote.icon ? (
                        <img
                          src={quote.icon}
                          alt={quote.symbol}
                          className="w-7 h-7 rounded-full border-2 border-[#121824] bg-slate-800 object-cover"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full border-2 border-[#121824] bg-sky-600 text-white flex items-center justify-center text-[10px] font-bold">
                          {quote.symbol.slice(0, 3)}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="font-black text-sm text-white flex items-center gap-1.5">
                        <span>{base.symbol}</span>
                        <span className="text-slate-400">/</span>
                        <span>{quote.symbol}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[150px]">
                        {base.name} • {quote.name}
                      </div>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-col items-end gap-1">
                    {vault.isUserVault && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase tracking-wider">
                        My Vault
                      </span>
                    )}
                    {vault.pricingType === "fixed" ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-950 text-sky-300 border border-sky-800/40">
                        Fixed Price
                      </span>
                    ) : isLegacyOracle ? (
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800/50"
                        title="This vault uses the decommissioned company oracle key and cannot be filled on-chain. Owner can cancel anytime."
                      >
                        Legacy Oracle (Inactive)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/40">
                        Oracle Dynamic
                      </span>
                    )}
                  </div>
                </div>

                {/* Reserves Section */}
                <div className="p-3 rounded-2xl bg-[#0b0e14] border border-[#1a2333] space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Vault Reserves
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-[#121824] p-2 rounded-xl border border-[#1f2d44]/50">
                      <div className="text-[10px] text-slate-400">{base.symbol}</div>
                      <div className="font-bold text-slate-100 truncate text-sm" title={baseAmountFormatted}>
                        {baseAmountFormatted}
                      </div>
                    </div>
                    <div className="bg-[#121824] p-2 rounded-xl border border-[#1f2d44]/50">
                      <div className="text-[10px] text-slate-400">{quote.symbol}</div>
                      <div className="font-bold text-slate-100 truncate text-sm" title={quoteAmountFormatted}>
                        {quoteAmountFormatted}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Prices in Both Directions */}
                <div className="p-3 rounded-2xl bg-[#141b2b] border border-purple-900/30 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold text-purple-300">
                    <span className="flex items-center gap-1">
                      <ArrowRightLeft className="w-3 h-3 text-purple-400" />
                      Two-Way Order Pricing
                    </span>
                  </div>

                  {vault.fixedPrice && (() => {
                    const priceBaseToQuote = isReversed
                      ? vault.fixedPrice.priceBtoA
                      : vault.fixedPrice.priceAtoB;
                    const priceQuoteToBase = isReversed
                      ? vault.fixedPrice.priceAtoB
                      : vault.fixedPrice.priceBtoA;

                    return (
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between bg-[#0b0e14] p-2 rounded-xl border border-[#1f2d44]/40">
                          <span className="text-slate-400 font-medium">1 {base.symbol} =</span>
                          <span className="font-bold text-white">
                            {formatNumericPrice(priceBaseToQuote)} {quote.symbol}
                          </span>
                        </div>
                        {vault.fixedPrice.hasReverse ? (
                          <div className="flex items-center justify-between bg-[#0b0e14] p-2 rounded-xl border border-[#1f2d44]/40">
                            <span className="text-slate-400 font-medium">1 {quote.symbol} =</span>
                            <span className="font-bold text-emerald-400">
                              {formatNumericPrice(priceQuoteToBase)} {base.symbol}
                            </span>
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-500 italic px-1">
                            One-way order (no reverse price)
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {vault.oracleDelta && (() => {
                    const pairKey = vault.canonicalPair.pairKey;
                    const liveOracle = oraclePrices[pairKey];
                    const derived = liveOracle ? calculateVaultOraclePrices(vault, liveOracle.price) : null;

                    return (
                      <div className="space-y-1.5 text-xs">
                        {/* Live Oracle Reference Rate */}
                        <div className="flex items-start justify-between px-1 text-[10px] text-slate-400">
                          <span className="flex items-center gap-1.5 pt-0.5 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Live Oracle:
                          </span>
                          {liveOracle ? (
                            <div className="flex flex-col items-end font-mono text-[10px] space-y-0.5">
                              <span className="text-emerald-400 font-semibold">
                                1 {base.symbol} = {formatNumericPrice(liveOracle.price)} {quote.symbol}
                              </span>
                              {liveOracle.price > 0 && (
                                <span className="text-slate-400">
                                  1 {quote.symbol} = {formatNumericPrice(1 / liveOracle.price)} {base.symbol}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="italic text-slate-500">Fetching live rate...</span>
                          )}
                        </div>

                        {/* Straight / Primary Price */}
                        {derived?.priceBaseToQuote ? (
                          <div className="flex items-center justify-between bg-[#0b0e14] p-2 rounded-xl border border-[#1f2d44]/40">
                            <div className="flex flex-col">
                              <span className="text-slate-400 font-medium">1 {base.symbol} =</span>
                              <span className="text-[9px] text-slate-500">
                                Straight ({vault.oracleDelta.formattedStraight})
                              </span>
                            </div>
                            <span className="font-bold text-white text-xs font-mono">
                              {formatNumericPrice(derived.priceBaseToQuote)} {quote.symbol}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between bg-[#0b0e14] p-2 rounded-xl border border-[#1f2d44]/40">
                            <span className="text-slate-400 font-medium">Straight:</span>
                            <span className="font-bold text-emerald-400 text-xs">
                              {vault.oracleDelta.formattedStraight}
                            </span>
                          </div>
                        )}

                        {/* Reverse Leg Price */}
                        {vault.oracleDelta.hasReverse ? (
                          derived?.priceQuoteToBase ? (
                            <div className="flex items-center justify-between bg-[#0b0e14] p-2 rounded-xl border border-[#1f2d44]/40">
                              <div className="flex flex-col">
                                <span className="text-slate-400 font-medium">1 {quote.symbol} =</span>
                                <span className="text-[9px] text-slate-500">
                                  Reverse ({vault.oracleDelta.formattedReverse || "Oracle Price"})
                                </span>
                              </div>
                              <span className="font-bold text-emerald-400 text-xs font-mono">
                                {formatNumericPrice(derived.priceQuoteToBase)} {base.symbol}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between bg-[#0b0e14] p-2 rounded-xl border border-[#1f2d44]/40">
                              <span className="text-slate-400 font-medium">Reverse Leg:</span>
                              <span className="font-bold text-sky-400 text-xs">
                                {vault.oracleDelta.formattedReverse || "Oracle Price"}
                              </span>
                            </div>
                          )
                        ) : (
                          <div className="text-[10px] text-slate-500 italic px-1">
                            One-way oracle order
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Footer Metadata */}
                <div className="pt-2 border-t border-[#1a2333] space-y-1 text-[11px] text-slate-400">
                  <div className="flex items-center justify-between">
                    <span>Owner PKH:</span>
                    <div className="flex items-center gap-1 font-mono text-slate-300">
                      <span>{vault.ownerKey.slice(0, 8)}...{vault.ownerKey.slice(-6)}</span>
                      <button
                        onClick={() => handleCopy(vault.ownerKey, `owner-${utxoId}`)}
                        className="hover:text-white p-0.5"
                        title="Copy Owner PKH"
                      >
                        {copiedKey === `owner-${utxoId}` ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span>UTxO:</span>
                    <div className="flex items-center gap-1 font-mono text-slate-300">
                      <span>{vault.utxoRef.txHash.slice(0, 8)}...#{vault.utxoRef.outputIndex}</span>
                      <a
                        href={`https://${settings.network === "preprod" ? "preprod." : ""}cardanoscan.io/transaction/${vault.utxoRef.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-white p-0.5"
                        title="View on Cardanoscan"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>

                {/* Action Buttons: Trade & Cancel */}
                <div className="mt-3 flex flex-col gap-2">
                  {isLegacyOracle ? (
                    <div
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#141b2b]/50 text-slate-500 border border-slate-800/60 font-medium text-xs cursor-not-allowed select-none"
                      title="This vault uses the defunct company oracle key and cannot be filled on-chain. Owner can cancel anytime."
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500/60 shrink-0" />
                      <span>Unfillable (Legacy Oracle Key)</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        if (!wallet.connected) {
                          onOpenWallet();
                        } else {
                          setTradingVault(vault);
                        }
                      }}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 hover:text-white border border-sky-500/40 transition-all font-bold text-xs shadow-sm active:scale-[0.99]"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5 text-sky-400" />
                      <span>Trade / Fill Liquidity</span>
                    </button>
                  )}

                  {/* Cancel Vault Button for Owner */}
                  {vault.isUserVault && (
                    <button
                      onClick={() => {
                        if (!wallet.connected) {
                          onOpenWallet();
                        } else {
                          setCancellingVault(vault);
                          setCancelTxHash(null);
                          setCancelError(null);
                        }
                      }}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-rose-500/30 transition-all font-semibold text-xs shadow-sm active:scale-[0.99]"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>Cancel Vault & Reclaim Assets</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {!loading && filteredVaults.length > 0 && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-[#121824] border border-[#1f2d44]">
          <div className="text-xs text-slate-400">
            Showing{" "}
            <span className="font-bold text-white">
              {(currentPage - 1) * pageSize + 1}
            </span>{" "}
            to{" "}
            <span className="font-bold text-white">
              {Math.min(currentPage * pageSize, filteredVaults.length)}
            </span>{" "}
            of <span className="font-bold text-white">{filteredVaults.length}</span> vaults
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-xl bg-[#182234] hover:bg-[#202c42] text-slate-200 border border-[#2d3d5a] text-xs disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="text-xs font-semibold px-3 py-1 bg-[#0b0e14] rounded-lg border border-[#1f2d44] text-slate-200">
              Page {currentPage} of {totalPages}
            </span>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-xl bg-[#182234] hover:bg-[#202c42] text-slate-200 border border-[#2d3d5a] text-xs disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="bg-[#0b0e14] border border-[#1f2d44] text-slate-300 text-xs rounded-xl px-2.5 py-1.5 outline-none"
            >
              <option value={12}>12 / page</option>
              <option value={24}>24 / page</option>
              <option value={60}>60 / page</option>
            </select>
          </div>
        </div>
      )}

      {/* Cancel Vault Confirmation Modal */}
      {cancellingVault && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-[#121824] border border-[#1f2d44] rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2d44]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Cancel Smart Liquidity Vault</h3>
                  <p className="text-xs text-slate-400">Reclaim locked assets to your wallet</p>
                </div>
              </div>
              {!isCancelling && (
                <button
                  onClick={() => {
                    setCancellingVault(null);
                    setCancelTxHash(null);
                    setCancelError(null);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#182234] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              {cancelTxHash ? (
                <div className="p-5 rounded-2xl bg-emerald-950/30 border border-emerald-800/40 text-center space-y-3">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                  <div className="space-y-1">
                    <h4 className="font-bold text-white text-sm">Cancellation Submitted!</h4>
                    <p className="text-xs text-slate-300">
                      The cancellation transaction was broadcast to Cardano. Your assets will appear back in your wallet as soon as the block confirms.
                    </p>
                  </div>
                  <div className="pt-2">
                    <a
                      href={`https://${settings.network === "preprod" ? "preprod." : ""}cardanoscan.io/transaction/${cancelTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:underline"
                    >
                      <span>View on Cardanoscan</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                  <button
                    onClick={() => {
                      setCancellingVault(null);
                      setCancelTxHash(null);
                      setCancelError(null);
                    }}
                    className="w-full mt-3 py-2.5 rounded-xl bg-[#1f2d44] hover:bg-[#283854] text-white text-xs font-bold transition-colors"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <div className="p-4 rounded-2xl bg-[#0b0e14] border border-[#1a2333] space-y-3">
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Trading Pair & Position
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">
                          {cancellingVault.canonicalPair.base.symbol} / {cancellingVault.canonicalPair.quote.symbol}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#141b2b] text-purple-300 border border-purple-800/30">
                          {cancellingVault.pricingType === "fixed" ? "Fixed Price" : "Oracle Dynamic"}
                        </span>
                      </div>
                      <span className="font-mono text-xs text-slate-400">
                        #{cancellingVault.utxoRef.outputIndex}
                      </span>
                    </div>
                  </div>

                  {/* Assets to reclaim */}
                  <div className="p-4 rounded-2xl bg-[#141b2b] border border-[#1f2d44] space-y-2">
                    <div className="text-[11px] font-semibold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Coins className="w-3.5 h-3.5 text-purple-400" />
                      <span>Assets Returning To Your Wallet</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                      <div className="bg-[#0b0e14] p-2.5 rounded-xl border border-[#1f2d44]/50">
                        <div className="text-[10px] text-slate-400">{cancellingVault.tokenA.symbol}</div>
                        <div className="font-bold text-slate-100 text-sm truncate" title={cancellingVault.formattedAmountA}>
                          {cancellingVault.formattedAmountA}
                        </div>
                      </div>
                      <div className="bg-[#0b0e14] p-2.5 rounded-xl border border-[#1f2d44]/50">
                        <div className="text-[10px] text-slate-400">{cancellingVault.tokenB.symbol}</div>
                        <div className="font-bold text-slate-100 text-sm truncate" title={cancellingVault.formattedAmountB}>
                          {cancellingVault.formattedAmountB}
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 italic pt-1">
                      All locked token reserves and the refundable ADA deposit will be returned in full to your address.
                    </p>
                  </div>

                  {/* Notice */}
                  <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5 leading-relaxed">
                      <span className="font-bold">On-chain transaction required</span>
                      <p className="text-[11px] text-amber-300/80">
                        Cancelling burns the position NFT and releases your funds from the Plutus script. A standard network fee (~0.35 ₳) will be required to execute the transaction.
                      </p>
                    </div>
                  </div>

                  {cancelError && (
                    <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                      <span className="font-bold">Cancellation Failed:</span> {cancelError}
                    </div>
                  )}

                  {/* Buttons */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={() => {
                        setCancellingVault(null);
                        setCancelError(null);
                      }}
                      disabled={isCancelling}
                      className="flex-1 py-2.5 rounded-xl bg-[#182234] hover:bg-[#202c42] text-slate-300 text-xs font-semibold border border-[#2d3d5a] transition-colors disabled:opacity-50"
                    >
                      Keep Vault
                    </button>
                    <button
                      onClick={handleConfirmCancel}
                      disabled={isCancelling}
                      className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white text-xs font-bold transition-all shadow-lg shadow-rose-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isCancelling ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Confirming in Wallet...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4" />
                          <span>Confirm Cancellation</span>
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Trade Vault Modal */}
      <TradeVaultModal
        vault={tradingVault}
        isOpen={!!tradingVault}
        onClose={() => setTradingVault(null)}
        onSuccess={() => {
          setTimeout(() => loadVaults(), 3000);
        }}
      />

      {/* Create Vault Modal */}
      <CreateVaultModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => {
          setTimeout(() => loadVaults(), 3000);
        }}
      />
    </div>
  );
};
