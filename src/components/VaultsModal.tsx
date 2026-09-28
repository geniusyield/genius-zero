import React from "react";
import { X, Vault, ShieldCheck, AlertTriangle, Layers, ExternalLink } from "lucide-react";
import { useApp } from "../context/AppContext";

interface VaultsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VaultsModal: React.FC<VaultsModalProps> = ({ isOpen, onClose }) => {
  const { settings } = useApp();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#121824] border border-[#1f2d44] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2d44]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
              <Vault className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-white">Staking Vaults & Decentralization</h2>
              <p className="text-xs text-slate-400">Sovereign contract access post-October 15, 2026</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#182234] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Key Assurance Notice */}
          <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 space-y-2">
            <div className="flex items-center gap-2 font-bold text-sm">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>Smart Contract Security & Custody</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Genius Yield staking vaults are immutable Plutus smart contracts on the Cardano blockchain.
              Your principal staked assets and NFTs are held directly on-chain under contract logic.
              They are <strong>not held on company servers</strong> and <strong>will not disappear</strong> when central servers cease operations.
            </p>
          </div>

          {/* Technical Context on October 15 Transition */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-400" />
              Decentralized Unstaking Path
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              When central web servers and databases shut down, the traditional frontend at <code>app.geniusyield.co</code> may become unavailable.
              Genius Zero is built specifically to bridge this gap:
            </p>

            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44]">
                <div className="font-bold text-white mb-1">Direct Contract Interaction</div>
                <div className="text-slate-400">
                  Genius Zero interacts directly with the on-chain validator scripts via Blockfrost, eliminating the need for an intermediary company API server.
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44]">
                <div className="font-bold text-white mb-1">Zero Maintenance Costs</div>
                <div className="text-slate-400">
                  Since Genius Zero runs completely in your browser without hosting databases or backend processes, it costs nothing to maintain and can never be shut down.
                </div>
              </div>
            </div>
          </div>

          {/* Staking Rules Overview */}
          <div className="p-4 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-2 text-xs">
            <div className="font-bold text-slate-200">On-Chain Staking Invariants:</div>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li>Vaults can be unlocked and principal withdrawn by the owner key hash specified in the vault datum.</li>
              <li>Reward distributions historically executed via weekly off-chain batches (<code className="text-slate-300">dex-analysis</code>).</li>
              <li>With Genius Zero, the community retains a permanent frontend to interact with their vaults anytime.</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#0e131d] border-t border-[#1f2d44] flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#182234] hover:bg-[#1f2d44] text-white text-xs font-bold border border-[#1f2d44] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
