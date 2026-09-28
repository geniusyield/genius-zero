import React, { useState } from "react";
import { X, Key, Globe, Clock, Shield, ExternalLink, Check } from "lucide-react";
import { useApp } from "../context/AppContext";
import { NetworkType } from "../types";

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
  const [autoRefresh, setAutoRefresh] = useState(settings.autoRefreshInterval);
  const [saved, setSaved] = useState(false);

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
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const currentKey = network === "mainnet" ? apiKeyMainnet : apiKeyPreprod;
  const setCurrentKey = (val: string) => {
    if (network === "mainnet") {
      setApiKeyMainnet(val);
    } else {
      setApiKeyPreprod(val);
    }
  };

  const handleSave = () => {
    const activeKey = network === "mainnet" ? apiKeyMainnet.trim() : apiKeyPreprod.trim();
    updateSettings({
      network,
      blockfrostApiKey: activeKey,
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
      <div className="bg-[#121824] border border-[#1f2d44] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2d44]">
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
        <div className="p-6 space-y-6">
          {/* Security Notice */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-sky-950/30 border border-sky-800/40 text-sky-300 text-xs">
            <Shield className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Client-Side Privacy Guarantee: </span>
              Your API key is stored exclusively in your browser's <code className="bg-sky-900/40 px-1 py-0.5 rounded text-[11px]">localStorage</code>.
              It is never sent to any central backend or third party.
            </div>
          </div>

          {/* Network Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              Cardano Network
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
                <span className={`w-2 h-2 rounded-full ${network === "preprod" ? "bg-amber-400" : "bg-slate-500"}`}></span>
                Preprod Testnet
              </button>
            </div>
          </div>

          {/* Blockfrost Project Key */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-slate-400" />
                Blockfrost Project Key
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
            <input
              type="password"
              value={currentKey}
              onChange={(e) => setCurrentKey(e.target.value)}
              placeholder={network === "mainnet" ? "mainnet..." : "preprod..."}
              className="w-full px-4 py-2.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] text-white text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
            />
            <p className="text-[11px] text-slate-400">
              Matches your selected network. e.g. starts with <code className="text-slate-300">mainnet</code> for Mainnet or <code className="text-slate-300">preprod</code> for Preprod.
            </p>
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
