import React, { useState } from "react";
import { X, Key, Globe, Clock, Shield, ExternalLink, Check, Database, Eye, EyeOff } from "lucide-react";
import { useApp } from "../context/AppContext";
import { NetworkType } from "../types";
import { getCacheStats, clearCardanoCache } from "../services/cache";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { settings, updateSettings } = useApp();

  const [network, setNetwork] = useState<NetworkType>(settings.network);
  const [apiKeyMainnet, setApiKeyMainnet] = useState(
    settings.blockfrostApiKeyMainnet ||
      (settings.network === "mainnet" ? settings.blockfrostApiKey : "")
  );
  const [apiKeyPreprod, setApiKeyPreprod] = useState(
    settings.blockfrostApiKeyPreprod ||
      (settings.network === "preprod" ? settings.blockfrostApiKey : "")
  );
  const [showMainnetKey, setShowMainnetKey] = useState(false);
  const [showPreprodKey, setShowPreprodKey] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(settings.autoRefreshInterval);
  const [saved, setSaved] = useState(false);
  const [cacheStats, setCacheStats] = useState({ datums: 0, transactions: 0, tokens: 0 });

  const loadStats = async () => {
    const stats = await getCacheStats();
    setCacheStats(stats);
  };

  const handleClearCache = async () => {
    await clearCardanoCache();
    await loadStats();
  };

  // Sync state whenever modal is opened
  React.useEffect(() => {
    if (isOpen) {
      setNetwork(settings.network);
      setApiKeyMainnet(
        settings.blockfrostApiKeyMainnet ||
          (settings.network === "mainnet" ? settings.blockfrostApiKey : "")
      );
      setApiKeyPreprod(
        settings.blockfrostApiKeyPreprod ||
          (settings.network === "preprod" ? settings.blockfrostApiKey : "")
      );
      setAutoRefresh(settings.autoRefreshInterval);
      loadStats();
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleSave = () => {
    updateSettings({
      network,
      blockfrostApiKeyMainnet: apiKeyMainnet.trim(),
      blockfrostApiKeyPreprod: apiKeyPreprod.trim(),
      autoRefreshInterval: autoRefresh,
    });
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#121824] border border-[#1f2d44] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2d44] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-white">Client Configuration</h2>
              <p className="text-xs text-slate-400">Manage your sovereign RPC credentials</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#182234] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Security Notice */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-sky-950/30 border border-sky-800/40 text-sky-300 text-xs">
            <Shield className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Client-Side Privacy Guarantee: </span>
              Your API keys are stored exclusively in your browser's <code className="bg-sky-900/40 px-1 py-0.5 rounded text-[11px]">localStorage</code>.
              They are never sent to any central backend or third party.
            </div>
          </div>

          {/* Network Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              Active Cardano Network
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setNetwork("mainnet")}
                className={`py-2.5 px-4 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                  network === "mainnet"
                    ? "bg-emerald-500/10 border-emerald-500 text-emerald-400 shadow-sm"
                    : "bg-[#182234] border-[#1f2d44] text-slate-400 hover:border-slate-600"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${network === "mainnet" ? "bg-emerald-400" : "bg-slate-500"}`}></span>
                Cardano Mainnet
              </button>

              <button
                type="button"
                onClick={() => setNetwork("preprod")}
                className={`py-2.5 px-4 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                  network === "preprod"
                    ? "bg-amber-500/10 border-amber-500 text-amber-400 shadow-sm"
                    : "bg-[#182234] border-[#1f2d44] text-slate-400 hover:border-slate-600"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${network === "preprod" ? "bg-amber-400 animate-pulse" : "bg-slate-500"}`}></span>
                Preprod Testnet
              </button>
            </div>
          </div>

          {/* Blockfrost Project Keys */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-slate-400" />
                Blockfrost Project Keys
              </label>
              <a
                href="https://blockfrost.io"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1"
              >
                Get free key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Mainnet Key Field */}
            <div className={`p-3.5 rounded-xl border transition-colors space-y-2 ${
              network === "mainnet"
                ? "bg-[#101827] border-emerald-500/40"
                : "bg-[#0f141f] border-[#1f2d44]"
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <span>Mainnet API Key</span>
                  {network === "mainnet" ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Active
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500">
                      (Standby)
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-slate-500 font-mono">starts with mainnet...</span>
              </div>
              <div className="relative">
                <input
                  type={showMainnetKey ? "text" : "password"}
                  value={apiKeyMainnet}
                  onChange={(e) => setApiKeyMainnet(e.target.value)}
                  placeholder="mainnet..."
                  className="w-full pl-3.5 pr-10 py-2 rounded-lg bg-[#070a0f] border border-[#1f2d44] text-white text-xs font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowMainnetKey(!showMainnetKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                >
                  {showMainnetKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[10px] text-slate-400">
                Used for mainnet trading, staking vaults, and rewards claiming.
              </p>
            </div>

            {/* Preprod Testnet Key Field */}
            <div className={`p-3.5 rounded-xl border transition-colors space-y-2 ${
              network === "preprod"
                ? "bg-[#1a1813] border-amber-500/40"
                : "bg-[#0f141f] border-[#1f2d44]"
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <span>Preprod Testnet Key</span>
                  {network === "preprod" ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      Active
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400">
                      Optional
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-slate-500 font-mono">starts with preprod...</span>
              </div>
              <div className="relative">
                <input
                  type={showPreprodKey ? "text" : "password"}
                  value={apiKeyPreprod}
                  onChange={(e) => setApiKeyPreprod(e.target.value)}
                  placeholder="preprod..."
                  className="w-full pl-3.5 pr-10 py-2 rounded-lg bg-[#070a0f] border border-[#1f2d44] text-white text-xs font-mono placeholder:text-slate-600 focus:outline-none focus:border-amber-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPreprodKey(!showPreprodKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                >
                  {showPreprodKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[10px] text-slate-400">
                Optional. Only needed when developing or running DEX integration tests on Cardano Preprod.
              </p>
            </div>
          </div>

          {/* Auto Refresh Interval */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              Order Book Auto-Refresh Interval
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[0, 15, 30, 60].map((interval) => (
                <button
                  key={interval}
                  type="button"
                  onClick={() => setAutoRefresh(interval)}
                  className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                    autoRefresh === interval
                      ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                      : "bg-[#182234] border-[#1f2d44] text-slate-400 hover:border-slate-600"
                  }`}
                >
                  {interval === 0 ? "Off" : `${interval}s`}
                </button>
              ))}
            </div>
          </div>

          {/* Cardano Local Immutable Cache */}
          <div className="p-4 rounded-xl bg-[#182234] border border-[#1f2d44] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                Cardano Immutable Cache (IndexedDB)
              </span>
              <button
                type="button"
                onClick={handleClearCache}
                className="text-[11px] text-rose-400 hover:text-rose-300 transition-colors"
              >
                Clear Cache
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Cardano eUTxO datums and confirmed transactions are mathematically immutable. Once cached in browser IndexedDB, they never need to be fetched again from Blockfrost, saving thousands of API requests.
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-[#0e131d] border border-[#1f2d44]/50">
                <span className="text-slate-500 text-[10px] uppercase font-semibold">Cached Datums</span>
                <div className="text-emerald-400 font-bold text-sm pt-0.5">{cacheStats.datums}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#0e131d] border border-[#1f2d44]/50">
                <span className="text-slate-500 text-[10px] uppercase font-semibold">Cached Txs</span>
                <div className="text-sky-400 font-bold text-sm pt-0.5">{cacheStats.transactions}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#0e131d] border-t border-[#1f2d44] flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold transition-all shadow-md shadow-emerald-500/20"
          >
            {saved ? (
              <>
                <Check className="w-4 h-4" />
                <span>Saved!</span>
              </>
            ) : (
              <span>Save & Connect</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
