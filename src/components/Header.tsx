import React from "react";
import {
  Wallet,
  Settings,
  RefreshCw,
  ChevronDown,
  Vault,
  Gift,
  ArrowUpDown,
  Loader2,
  Layers,
  TrendingUp,
  Github,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { getTradingPairs } from "../config/dex";
import { formatMinswapRate } from "../services/minswap";

export type AppTab = "trade" | "liquidity" | "staking" | "rewards" | "options";


interface HeaderProps {
  currentTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  onOpenSettings: () => void;
  onOpenWallet: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onSelectTab,
  onOpenSettings,
  onOpenWallet,
}) => {
  const {
    settings,
    updateSettings,
    wallet,
    disconnectWallet,
    activePair,
    setActivePair,
    loadingOrderBook,
    refreshOrderBook,
    minswapPrice,
  } = useApp();

  const [pairDropdownOpen, setPairDropdownOpen] = React.useState(false);

  const formatAddress = (addr: string) => {
    if (addr.length < 16) return addr;
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
  };

  const formatAda = (lovelace: bigint) => {
    return (Number(lovelace) / 1_000_000).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <header className="border-b border-[#1f2d44] bg-[#121824]/95 backdrop-blur sticky top-0 z-30 px-2.5 sm:px-4 md:px-8 py-2 md:py-2.5 w-full max-w-full overflow-x-hidden">
      {/* Primary Top Row */}
      <div className="flex items-center justify-between gap-1.5 sm:gap-2 min-w-0">
        {/* Left: Brand & Desktop Navigation */}
        <div className="flex items-center gap-1.5 sm:gap-3 md:gap-6 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 cursor-pointer shrink-0" onClick={() => onSelectTab("trade")}>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-gradient-to-tr from-emerald-500 to-sky-400 flex items-center justify-center font-black text-slate-950 text-sm sm:text-base shadow-lg shadow-emerald-500/20">
              0
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs sm:text-sm md:text-base tracking-tight text-white whitespace-nowrap">
                  Genius Zero
                </span>
                <span className="hidden sm:inline-flex px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/40 uppercase tracking-wide">
                  Serverless
                </span>
              </div>
            </div>
          </div>

          {/* Desktop View Switcher Tabs (Hidden on mobile) */}
          <nav className="hidden md:flex items-center gap-1 bg-[#0b0e14] p-1 rounded-xl border border-[#1f2d44]">
            <button
              onClick={() => onSelectTab("trade")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                currentTab === "trade"
                  ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-emerald-400" />
              <span>Trade</span>
            </button>

            <button
              onClick={() => onSelectTab("liquidity")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                currentTab === "liquidity"
                  ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-purple-400" />
              <span>Liquidity Vaults</span>
            </button>

            <button
              onClick={() => onSelectTab("staking")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                currentTab === "staking"
                  ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Vault className="w-3.5 h-3.5 text-sky-400" />
              <span>Staking Vaults</span>
            </button>

            <button
              onClick={() => onSelectTab("rewards")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                currentTab === "rewards"
                  ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Gift className="w-3.5 h-3.5 text-rose-400" />
              <span>Claim Rewards</span>
            </button>

            <button
              onClick={() => onSelectTab("options")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                currentTab === "options"
                  ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span>Options</span>
            </button>
          </nav>

          {/* Desktop Pair Selector (Hidden on mobile) */}
          {currentTab === "trade" && (
            <div className="hidden md:flex items-center gap-2.5">
              <div className="relative">
                <button
                  onClick={() => setPairDropdownOpen(!pairDropdownOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#182234] border border-[#1f2d44] hover:border-slate-600 transition-colors text-xs font-semibold text-slate-200"
                >
                  <span className="text-white">{activePair.baseToken.symbol}</span>
                  <span className="text-slate-500">/</span>
                  <span className="text-slate-400">{activePair.quoteToken.symbol}</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {pairDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1.5 w-48 rounded-xl bg-[#121824] border border-[#1f2d44] shadow-2xl p-1.5 z-50">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2.5 py-1">
                      Trading Pairs
                    </div>
                    {!getTradingPairs(settings.network).some((p) => p.id === activePair.id) && (
                      <div className="mb-1 pb-1 border-b border-[#1f2d44]">
                        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-semibold text-white truncate">{activePair.baseToken.symbol}</span>
                            <span className="text-slate-500">/</span>
                            <span className="text-slate-400">{activePair.quoteToken.symbol}</span>
                          </div>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                        </div>
                      </div>
                    )}
                    {getTradingPairs(settings.network).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setActivePair(p);
                          setPairDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          activePair.id === p.id
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "text-slate-300 hover:bg-[#182234]"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold">{p.baseToken.symbol}</span>
                          <span className="text-slate-500">/</span>
                          <span className="text-slate-400">{p.quoteToken.symbol}</span>
                        </div>
                        {activePair.id === p.id && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Minswap reference pill */}
              {minswapPrice && minswapPrice.available && (
                <div
                  className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-950/30 border border-blue-500/25 text-[11px] font-mono text-slate-300 shadow-sm"
                  title={`Minswap market rate:\n1 ${activePair.baseToken.symbol} = ${formatMinswapRate(minswapPrice.priceBaseInQuote)} ${activePair.quoteToken.symbol}\n1 ${activePair.quoteToken.symbol} = ${formatMinswapRate(minswapPrice.priceQuoteInBase)} ${activePair.baseToken.symbol}`}
                >
                  <span className="text-[10px] text-blue-400 font-sans font-bold">Minswap:</span>
                  <span className="text-white font-semibold">
                    1 {activePair.baseToken.symbol} = {formatMinswapRate(minswapPrice.priceBaseInQuote)} {activePair.quoteToken.symbol}
                  </span>
                  <span className="text-slate-500">⇄</span>
                  <span className="text-slate-300">
                    1 {activePair.quoteToken.symbol} = {formatMinswapRate(minswapPrice.priceQuoteInBase)} {activePair.baseToken.symbol}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Actions: Refresh (desktop), Network, Settings, Wallet */}
        <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 shrink-0">
          {/* Refresh button (desktop trade mode) */}
          {currentTab === "trade" && (
            <button
              onClick={() => refreshOrderBook()}
              title="Refresh order book"
              className="hidden md:flex p-2 rounded-lg bg-[#182234] border border-[#1f2d44] text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loadingOrderBook ? "animate-spin text-emerald-400" : ""}`}
              />
            </button>
          )}

          {/* Interactive Network Switcher */}
          <button
            onClick={() => {
              const nextNet = settings.network === "mainnet" ? "preprod" : "mainnet";
              updateSettings({ network: nextNet });
            }}
            title={`Active Network: ${settings.network === "mainnet" ? "Cardano Mainnet" : "Preprod Testnet"}. Click to switch.`}
            className={`inline-flex items-center px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-[11px] md:text-xs font-mono font-medium rounded-full border transition-all cursor-pointer hover:brightness-125 active:scale-95 shrink-0 ${
              settings.network === "mainnet"
                ? "bg-emerald-950/60 text-emerald-300 border-emerald-800/40 hover:border-emerald-600"
                : "bg-amber-950/60 text-amber-300 border-amber-800/40 hover:border-amber-600"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full mr-1 ${
                settings.network === "mainnet" ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
              }`}
            ></span>
            <span className="hidden sm:inline">{settings.network === "mainnet" ? "Mainnet" : "Preprod"}</span>
            <span className="sm:hidden">{settings.network === "mainnet" ? "Main" : "Prep"}</span>
          </button>

          {/* GitHub Repository Link */}
          <a
            href="https://github.com/geniusyield/genius-zero"
            target="_blank"
            rel="noopener noreferrer"
            title="View Genius Zero Source Code on GitHub"
            aria-label="Genius Zero GitHub Repository"
            className="p-1.5 sm:p-2 rounded-lg bg-[#182234] border border-[#1f2d44] text-slate-300 hover:text-white hover:border-slate-600 transition-colors shrink-0"
          >
            <Github className="w-3.5 h-3.5" />
          </a>

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            title="Configure Blockfrost API Key & Network"
            className={`p-1.5 sm:p-2 rounded-lg border transition-colors shrink-0 ${
              !settings.blockfrostApiKey
                ? "bg-amber-500/20 border-amber-500 text-amber-300 animate-pulse"
                : "bg-[#182234] border-[#1f2d44] text-slate-300 hover:text-white hover:border-slate-600"
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          {/* Wallet Connect Button */}
          {wallet.connected && wallet.address ? (
            <div className={`flex items-center gap-1 sm:gap-2 px-1.5 sm:px-3 py-0.5 sm:py-1.5 rounded-lg bg-[#182234] border text-[10px] sm:text-xs shrink-0 max-w-[130px] sm:max-w-none ${
              (settings.network === "preprod" && !wallet.address.startsWith("addr_test1")) ||
              (settings.network === "mainnet" && !wallet.address.startsWith("addr1"))
                ? "border-rose-500/60 bg-rose-950/20"
                : settings.network === "preprod"
                ? "border-amber-500/30"
                : "border-emerald-500/30"
            }`}>
              <div className="flex flex-col text-right min-w-0">
                {(settings.network === "preprod" && !wallet.address.startsWith("addr_test1")) ||
                (settings.network === "mainnet" && !wallet.address.startsWith("addr1")) ? (
                  <span className="font-bold text-rose-400 font-mono text-[9px] sm:text-[10px]">
                    Wrong Net
                  </span>
                ) : (
                  <span className={`font-semibold font-mono text-[9px] sm:text-xs truncate ${
                    settings.network === "preprod" ? "text-amber-400" : "text-emerald-400"
                  }`}>
                    {formatAda(wallet.balanceLovelace)} {settings.network === "preprod" ? "tADA" : "ADA"}
                  </span>
                )}
                <span className="text-[8px] sm:text-[10px] text-slate-400 font-mono truncate">
                  {formatAddress(wallet.address)}
                </span>
              </div>
              <button
                onClick={disconnectWallet}
                title="Disconnect Wallet"
                className="ml-0.5 sm:ml-1 text-slate-400 hover:text-rose-400 transition-colors text-sm leading-none shrink-0"
              >
                ×
              </button>
            </div>
          ) : wallet.connecting ? (
            <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-[#182234] border border-emerald-500/30 text-slate-300 text-xs font-medium shrink-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              <span className="hidden sm:inline">Connecting...</span>
            </div>
          ) : (
            <button
              onClick={onOpenWallet}
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3.5 py-1 sm:py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold transition-all shadow-md shadow-emerald-500/20 shrink-0"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Connect Wallet</span>
              <span className="sm:hidden">Connect</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile Sub-Navigation Bar (< md) */}
      <div className="md:hidden mt-2 pt-2 border-t border-[#1f2d44]/70 space-y-2">
        {/* Navigation Tabs */}
        <nav className="grid grid-cols-5 gap-1 bg-[#0b0e14] p-1 rounded-xl border border-[#1f2d44]">
          <button
            onClick={() => onSelectTab("trade")}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1 py-1.5 px-1 rounded-lg text-[11px] font-bold transition-all ${
              currentTab === "trade"
                ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-emerald-400" />
            <span>Trade</span>
          </button>

          <button
            onClick={() => onSelectTab("liquidity")}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1 py-1.5 px-1 rounded-lg text-[11px] font-bold transition-all ${
              currentTab === "liquidity"
                ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span>Vaults</span>
          </button>

          <button
            onClick={() => onSelectTab("staking")}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1 py-1.5 px-1 rounded-lg text-[11px] font-bold transition-all ${
              currentTab === "staking"
                ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Vault className="w-3.5 h-3.5 text-sky-400" />
            <span>Staking</span>
          </button>

          <button
            onClick={() => onSelectTab("rewards")}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1 py-1.5 px-1 rounded-lg text-[11px] font-bold transition-all ${
              currentTab === "rewards"
                ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Gift className="w-3.5 h-3.5 text-rose-400" />
            <span>Rewards</span>
          </button>

          <button
            onClick={() => onSelectTab("options")}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1 py-1.5 px-1 rounded-lg text-[11px] font-bold transition-all ${
              currentTab === "options"
                ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>Options</span>
          </button>
        </nav>

        {/* Mobile Trade Controls (Pair Selector + Refresh + Minswap Preview) */}
        {currentTab === "trade" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              {/* Mobile Pair Selector */}
              <div className="relative flex-1">
                <button
                  onClick={() => setPairDropdownOpen(!pairDropdownOpen)}
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#182234] border border-[#1f2d44] text-xs font-semibold text-slate-200"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-400 uppercase font-mono">Pair:</span>
                    <span className="text-white font-bold">{activePair.baseToken.symbol}</span>
                    <span className="text-slate-500">/</span>
                    <span className="text-slate-300">{activePair.quoteToken.symbol}</span>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {pairDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1.5 rounded-xl bg-[#121824] border border-[#1f2d44] shadow-2xl p-1.5 z-50">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2.5 py-1">
                      Select Trading Pair
                    </div>
                    {!getTradingPairs(settings.network).some((p) => p.id === activePair.id) && (
                      <div className="mb-1 pb-1 border-b border-[#1f2d44]">
                        <div className="flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-semibold text-white truncate">{activePair.baseToken.symbol}</span>
                            <span className="text-slate-500">/</span>
                            <span className="text-slate-400">{activePair.quoteToken.symbol}</span>
                          </div>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                        </div>
                      </div>
                    )}
                    {getTradingPairs(settings.network).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setActivePair(p);
                          setPairDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                          activePair.id === p.id
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "text-slate-300 hover:bg-[#182234]"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-white">{p.baseToken.symbol}</span>
                          <span className="text-slate-500">/</span>
                          <span className="text-slate-400">{p.quoteToken.symbol}</span>
                        </div>
                        {activePair.id === p.id && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Mobile Refresh Button */}
              <button
                onClick={() => refreshOrderBook()}
                title="Refresh order book"
                className="p-2 rounded-lg bg-[#182234] border border-[#1f2d44] text-slate-300 hover:text-white"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${loadingOrderBook ? "animate-spin text-emerald-400" : ""}`}
                />
              </button>
            </div>

            {/* Mobile Minswap rate strip */}
            {minswapPrice && minswapPrice.available && (
              <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-blue-950/20 border border-blue-500/20 text-[9px] sm:text-[10px] font-mono text-slate-300 min-w-0 overflow-hidden">
                <span className="text-blue-400 font-sans font-bold shrink-0 mr-1.5">Minswap:</span>
                <div className="flex items-center justify-end gap-1.5 min-w-0 flex-1 truncate">
                  <span className="truncate">1 {activePair.baseToken.symbol} = {formatMinswapRate(minswapPrice.priceBaseInQuote)} {activePair.quoteToken.symbol}</span>
                  <span className="text-slate-500 shrink-0">⇄</span>
                  <span className="truncate">1 {activePair.quoteToken.symbol} = {formatMinswapRate(minswapPrice.priceQuoteInBase)} {activePair.baseToken.symbol}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
