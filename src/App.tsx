import React, { useState } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { Header, AppTab } from "./components/Header";
import { OrderBookView } from "./components/OrderBookView";
import { TradePanel } from "./components/TradePanel";
import { UserOrdersView } from "./components/UserOrdersView";
import { StakingView } from "./components/StakingView";
import { RewardsClaimView } from "./components/RewardsClaimView";
import { SettingsModal } from "./components/SettingsModal";
import { WalletModal } from "./components/WalletModal";
import { Key, Cpu, AlertTriangle } from "lucide-react";

function MainContent() {
  const { settings, error, clearError } = useApp();
  const [currentTab, setCurrentTab] = useState<AppTab>("trade");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  const [selectedPrice, setSelectedPrice] = useState<number | undefined>();
  const [selectedAmount, setSelectedAmount] = useState<number | undefined>();

  const handleSelectPrice = (price: number, amount?: number) => {
    setSelectedPrice(price);
    if (amount) setSelectedAmount(amount);
  };

  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-100 flex flex-col font-sans">
      <Header
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenWallet={() => setWalletOpen(true)}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 space-y-6">
        {/* Global Notice / Error Banner */}
        {error && (
          <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-rose-950/40 border border-rose-800/50 text-rose-200 shadow-lg shadow-rose-950/20">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="text-xs">
                <span className="font-bold block text-sm text-white">Notice</span>
                {error}
              </div>
            </div>
            <button
              onClick={clearError}
              className="px-3 py-1.5 rounded-lg bg-rose-900/40 hover:bg-rose-900/60 text-rose-200 text-xs font-semibold shrink-0 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
        {/* Banner if Blockfrost API Key is Missing */}
        {!settings.blockfrostApiKey && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-2xl bg-amber-950/30 border border-amber-500/40 text-amber-200 shadow-lg shadow-amber-950/20">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 shrink-0">
                <Key className="w-5 h-5" />
              </div>
              <div className="text-xs">
                <span className="font-bold block text-sm text-white">Blockfrost API Key Required</span>
                Genius Zero interacts directly with Cardano. Enter your free Blockfrost key to query on-chain data and sign transactions.
              </div>
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shrink-0 transition-colors shadow-md shadow-amber-500/20"
            >
              Configure Key
            </button>
          </div>
        )}

        {/* Tab 1: DEX Trading & Order Book */}
        {currentTab === "trade" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-[580px]">
              <div className="lg:col-span-2 h-full">
                <OrderBookView onSelectPrice={handleSelectPrice} />
              </div>
              <div className="lg:col-span-1 h-full">
                <TradePanel
                  initialPrice={selectedPrice}
                  initialAmount={selectedAmount}
                  onOpenWallet={() => setWalletOpen(true)}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              </div>
            </div>

            <div>
              <UserOrdersView />
            </div>
          </div>
        )}

        {/* Tab 2: Staking Vaults */}
        {currentTab === "staking" && (
          <StakingView
            onOpenWallet={() => setWalletOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        {/* Tab 3: Rewards Claiming */}
        {currentTab === "rewards" && (
          <RewardsClaimView
            onOpenWallet={() => setWalletOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1f2d44] py-6 px-4 text-center text-xs text-slate-400 bg-[#0e131d]/60 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-emerald-400" />
            <span>Genius Zero — Serverless & Sovereign Client for Genius Yield</span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>Cardano Plutus V2 Contracts</span>
            <span>•</span>
            <span>DEX Trading • Staking Vaults • Rewards Claiming</span>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <WalletModal
        isOpen={walletOpen}
        onClose={() => setWalletOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainContent />
    </AppProvider>
  );
}
