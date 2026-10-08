import React, { useState } from "react";
import { X, Wallet, ExternalLink, Loader2, Smartphone, ChevronDown, ChevronUp } from "lucide-react";
import { useApp } from "../context/AppContext";

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WalletModal: React.FC<WalletModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { availableWallets, connectWalletById, wallet, error, settings } = useApp();
  const [showMobileHelp, setShowMobileHelp] = useState(false);

  if (!isOpen) return null;

  const handleConnect = async (id: string) => {
    const success = await connectWalletById(id);
    if (success) {
      onClose();
    }
  };

  const activeError = error || wallet.error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#121824] border border-[#1f2d44] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2d44]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-lg text-white">Connect Wallet</h2>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                    settings.network === "mainnet"
                      ? "bg-emerald-950/80 text-emerald-300 border-emerald-800/60"
                      : "bg-amber-950/80 text-amber-300 border-amber-800/60"
                  }`}
                >
                  {settings.network === "mainnet" ? "Mainnet" : "Preprod"}
                </span>
              </div>
              <p className="text-xs text-slate-400">Select an installed CIP-30 wallet</p>
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
        <div className="p-6 space-y-4">
          {activeError && (
            <div className="p-3.5 rounded-xl bg-rose-950/50 border border-rose-800/60 text-rose-200 text-xs space-y-1">
              <div className="font-bold text-rose-300">Connection Alert</div>
              <div className="leading-relaxed">{activeError}</div>
            </div>
          )}

          {settings.network === "preprod" && !activeError && (
            <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs leading-relaxed">
              <span className="font-bold">Preprod Mode:</span> Make sure your wallet (e.g. Eternl) has its network toggled to <strong>Preprod</strong> and a Preprod account active.
            </div>
          )}

          {availableWallets.length > 0 ? (
            <div className="space-y-2">
              {availableWallets.map((w) => (
                <button
                  key={w.id}
                  onClick={() => handleConnect(w.id)}
                  disabled={wallet.connecting}
                  className="w-full flex items-center justify-between p-3.5 rounded-xl bg-[#182234] border border-[#1f2d44] hover:border-emerald-500 hover:bg-[#1f2d44] transition-all group"
                >
                  <div className="flex items-center gap-3">
                    {w.icon ? (
                      <img src={w.icon} alt={w.name} className="w-7 h-7 rounded-full object-contain" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                        {w.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <span className="font-bold text-sm text-slate-200 group-hover:text-white">
                      {w.name}
                    </span>
                  </div>

                  {wallet.connecting && wallet.walletName === w.id ? (
                    <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                  ) : (
                    <span className="text-xs font-semibold text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      Connect →
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-5 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto">
                <Wallet className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-slate-200 text-sm mb-1">No Cardano Wallets Detected</h3>
                <p className="text-xs text-slate-400 max-w-xs mx-auto">
                  Please install a Cardano wallet supporting the CIP-30 standard, or use the mobile browser options below.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 text-left">
                {[
                  { name: "Eternl", url: "https://eternl.io" },
                  { name: "Lace", url: "https://lace.io" },
                  { name: "Vespr", url: "https://vespr.xyz" },
                  { name: "Yoroi", url: "https://yoroi-wallet.com" },
                ].map((item) => (
                  <a
                    key={item.name}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#182234] border border-[#1f2d44] hover:border-slate-600 text-xs font-medium text-slate-300 hover:text-white"
                  >
                    <span>{item.name}</span>
                    <ExternalLink className="w-3 h-3 text-slate-500" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Mobile Wallet Helper Guide */}
          <div className="pt-2 border-t border-[#1f2d44]">
            <button
              onClick={() => setShowMobileHelp(!showMobileHelp)}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] text-xs text-slate-300 hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold">Using on Android or iOS?</span>
              </div>
              {showMobileHelp ? (
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              )}
            </button>

            {showMobileHelp && (
              <div className="mt-2 p-3.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] text-xs text-slate-300 space-y-3 leading-relaxed">
                <div>
                  <div className="font-bold text-white flex items-center gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span>1. Eternl Mobile App (In-App Browser)</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    Open the <strong>Eternl app</strong> on your phone → tap the <strong>DApps / Browser</strong> tab in the bottom menu → paste the Genius Zero link. The Eternl browser automatically injects the CIP-30 wallet interface.
                  </p>
                </div>

                <div>
                  <div className="font-bold text-white flex items-center gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                    <span>2. Kiwi Browser or Mises Browser (Android)</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    Standard mobile Chrome does not support extensions. Installing <strong>Kiwi Browser</strong> or <strong>Mises Browser</strong> on Android lets you install desktop Chrome extensions like <strong>Lace</strong> or <strong>Eternl</strong> directly on mobile.
                  </p>
                </div>

                <div>
                  <div className="font-bold text-white flex items-center gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                    <span>3. VESPR Mobile Wallet</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    Install <strong>VESPR</strong> on Android or iOS → use its built-in Web3 browser to open Genius Zero and connect natively.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
