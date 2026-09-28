import React from "react";
import { Loader2, X, Database } from "lucide-react";
import { FetchProgress } from "../types";

export interface ProgressBarProps {
  progress: FetchProgress;
  onCancel?: () => void;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  onCancel,
  className = "",
}) => {
  const { current, total, stage, itemType } = progress;
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((current / total) * 100))) : 0;

  return (
    <div
      className={`p-3.5 rounded-xl bg-[#0f172a]/90 border border-emerald-500/30 shadow-lg space-y-2.5 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-slate-300 min-w-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0" />
          <span className="font-medium text-slate-200 truncate">{stage}</span>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="font-mono text-xs font-bold text-white bg-[#0e131d] px-2 py-0.5 rounded border border-[#1f2d44]">
            {current} / {total} <span className="text-slate-400 font-normal">{itemType || "UTxOs"}</span>
          </span>
          <span className="text-[11px] font-mono font-semibold text-emerald-400 min-w-[34px] text-right">
            {pct}%
          </span>
          {onCancel && (
            <button
              onClick={onCancel}
              type="button"
              title="Cancel ongoing fetch"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[10px] font-semibold border border-rose-500/20 transition-colors"
            >
              <X className="w-3 h-3" />
              <span>Stop</span>
            </button>
          )}
        </div>
      </div>

      {/* Progress Track */}
      <div className="w-full bg-[#0e131d] rounded-full h-2 overflow-hidden border border-[#1f2d44]/70">
        <div
          className="bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-400 h-full rounded-full transition-all duration-200 ease-out shadow-sm shadow-emerald-500/30"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span className="flex items-center gap-1 text-slate-400">
          <Database className="w-2.5 h-2.5 text-emerald-400" />
          Cardano eUTxO datums cached permanently in browser
        </span>
        {total > 50 && (
          <span className="text-slate-500 hidden sm:inline">
            Batch-buffered for Blockfrost rate limits
          </span>
        )}
      </div>
    </div>
  );
};
