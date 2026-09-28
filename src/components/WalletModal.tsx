import React from "react";
import { X, Wallet, ExternalLink, Loader2 } from "lucide-react";
import { useApp } from "../context/AppContext";

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WalletModal: React.FC<WalletModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { availableWallets, connectWalletById, wallet, error } = useApp();

  if (!isOpen) return null;

  const handleConnect = async (id: string) => {
    await connectWalletById(id);
    if (!wallet.error) {
      onClose();
    }
  };

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
              <h2 className="font-bold text-lg text-white">Connect Cardano Wallet</h2>
              <p className="text-xs text-slate-400">Select an installed CIP-30 extension</p>
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
          {error && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs">
              {error}
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
            <div className="text-center py-6 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto">
                <Wallet className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-slate-200 text-sm mb-1">No Cardano Wallets Detected</h3>
                <p className="text-xs text-slate-400 max-w-xs mx-auto">
                  Please install a Cardano browser extension wallet supporting the CIP-30 standard.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 text-left">
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
        </div>
      </div>
    </div>
  );
};
