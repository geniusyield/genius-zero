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
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { getTradingPairs } from "../config/dex";

export type AppTab = "trade" | "staking" | "rewards";

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
    <header className="border-b border-[#1f2d44] bg-[#121824]/90 backdrop-blur sticky top-0 z-30 px-4 md:px-8 py-2.5 flex items-center justify-between">
      {/* Left: Brand & Main Navigation Tabs */}
      <div className="flex items-center gap-4 md:gap-8">
        <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => onSelectTab("trade")}>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-sky-400 flex items-center justify-center font-black text-slate-950 text-lg shadow-lg shadow-emerald-500/20">
            0
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-base tracking-tight text-white">
                Genius Zero
              </span>
              <span className="hidden sm:inline-flex px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/40 uppercase tracking-wide">
                Serverless
              </span>
            </div>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <nav className="flex items-center gap-1 bg-[#0b0e14] p-1 rounded-xl border border-[#1f2d44]">
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
        </nav>

        {/* Pair Selector (only active when on Trade tab) */}
        {currentTab === "trade" && (
          <div className="relative hidden md:block">
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
        )}
      </div>

      {/* Right Actions: Refresh, Network, Settings, Wallet */}
      <div className="flex items-center gap-2 md:gap-3">
        {/* Refresh button (when in trade mode) */}
        {currentTab === "trade" && (
          <button
            onClick={() => refreshOrderBook()}
            title="Refresh order book"
            className="p-2 rounded-lg bg-[#182234] border border-[#1f2d44] text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
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
          className={`inline-flex items-center px-2.5 py-1 text-xs font-mono font-medium rounded-full border transition-all cursor-pointer hover:brightness-125 active:scale-95 ${
            settings.network === "mainnet"
              ? "bg-emerald-950/60 text-emerald-300 border-emerald-800/40 hover:border-emerald-600"
              : "bg-amber-950/60 text-amber-300 border-amber-800/40 hover:border-amber-600"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
              settings.network === "mainnet" ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
            }`}
          ></span>
          <span>{settings.network === "mainnet" ? "Mainnet" : "Preprod"}</span>
        </button>

        {/* Settings Button */}
        <button
          onClick={onOpenSettings}
          title="Configure Blockfrost API Key & Network"
          className={`p-2 rounded-lg border transition-colors ${
            !settings.blockfrostApiKey
              ? "bg-amber-500/20 border-amber-500 text-amber-300 animate-pulse"
              : "bg-[#182234] border-[#1f2d44] text-slate-300 hover:text-white hover:border-slate-600"
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* Wallet Connect Button */}
        {wallet.connected && wallet.address ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#182234] border border-emerald-500/30 text-xs">
            <div className="flex flex-col text-right">
              <span className="font-semibold text-emerald-400 font-mono">
                {formatAda(wallet.balanceLovelace)} ADA
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {formatAddress(wallet.address)}
              </span>
            </div>
            <button
              onClick={disconnectWallet}
              title="Disconnect Wallet"
              className="ml-1 text-slate-400 hover:text-rose-400 transition-colors"
            >
              ×
            </button>
          </div>
        ) : wallet.connecting ? (
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#182234] border border-emerald-500/30 text-slate-300 text-xs md:text-sm font-medium">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            <span>Connecting...</span>
          </div>
        ) : (
          <button
            onClick={onOpenWallet}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs md:text-sm font-bold transition-all shadow-md shadow-emerald-500/20"
          >
            <Wallet className="w-4 h-4" />
            <span>Connect Wallet</span>
          </button>
        )}
      </div>
    </header>
  );
};
