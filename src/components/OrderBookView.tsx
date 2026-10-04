import React from "react";
import { ArrowUp, ArrowDown, Activity, RefreshCw } from "lucide-react";
import { useApp } from "../context/AppContext";
import { DexOrder } from "../types";
import { ProgressBar } from "./ProgressBar";

interface OrderBookViewProps {
  onSelectPrice?: (price: number, amount?: number) => void;
  onSelectOrder?: (order: DexOrder) => void;
  selectedOrderKey?: string | null;
}

export const OrderBookView: React.FC<OrderBookViewProps> = ({
  onSelectPrice,
  onSelectOrder,
  selectedOrderKey,
}) => {
  const { orderBook, activePair, loadingOrderBook, orderBookProgress, cancelRefreshOrderBook } = useApp();

  const formatPrice = (p: number) => {
    if (p < 0.0001) return p.toExponential(4);
    if (p < 1) return p.toFixed(6);
    return p.toFixed(4);
  };

  const formatAmount = (amt: bigint, decimals: number) => {
    const val = Number(amt) / Math.pow(10, decimals);
    if (val > 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
    if (val > 1_000) return `${(val / 1_000).toFixed(2)}k`;
    return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const getAmountNumber = (amt: bigint, decimals: number) => {
    return Number(amt) / Math.pow(10, decimals);
  };

  // Calculate cumulative depth totals for visual bars
  const asks = orderBook.asks.slice(0, 15);
  const bids = orderBook.bids.slice(0, 15);

  let askTotalAcc = 0;
  const asksWithDepth = asks.map((order) => {
    const amt = getAmountNumber(order.offeredAmount, activePair.baseToken.decimals);
    askTotalAcc += amt;
    return { ...order, amt, totalQuote: amt * order.effectivePrice, cumulative: askTotalAcc };
  });
  const maxAskDepth = askTotalAcc > 0 ? askTotalAcc : 1;

  let bidTotalAcc = 0;
  const bidsWithDepth = bids.map((order) => {
    const amt = getAmountNumber(order.offeredAmount, activePair.quoteToken.decimals) / (order.effectivePrice || 1);
    bidTotalAcc += amt;
    return { ...order, amt, totalQuote: amt * order.effectivePrice, cumulative: bidTotalAcc };
  });
  const maxBidDepth = bidTotalAcc > 0 ? bidTotalAcc : 1;

  return (
    <div className="flex flex-col h-full bg-[#121824] border border-[#1f2d44] rounded-2xl overflow-hidden shadow-xl">
      {/* Table Header */}
      <div className="px-4 py-3 border-b border-[#1f2d44] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-bold text-white tracking-tight">On-Chain Order Book</h3>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span>{activePair.baseToken.symbol} / {activePair.quoteToken.symbol}</span>
          {loadingOrderBook && (
            <RefreshCw className="w-3 h-3 text-emerald-400 animate-spin" />
          )}
        </div>
      </div>

      {/* Progress Bar during fetch */}
      {loadingOrderBook && orderBookProgress && (
        <div className="p-3 bg-[#0d121c] border-b border-[#1f2d44]">
          <ProgressBar
            progress={orderBookProgress}
            onCancel={cancelRefreshOrderBook}
          />
        </div>
      )}

      {/* Column Titles */}
      <div className="grid grid-cols-3 px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-[#1f2d44]/50 bg-[#0e131d]">
        <div className="text-left">Price ({activePair.quoteToken.symbol})</div>
        <div className="text-right">Size ({activePair.baseToken.symbol})</div>
        <div className="text-right">Total ({activePair.quoteToken.symbol})</div>
      </div>

      {/* Asks (Sell Orders) - display highest to lowest so lowest ask is adjacent to spread */}
      <div className="flex-1 overflow-y-auto flex flex-col justify-end p-1 space-y-0.5">
        {asksWithDepth.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500 italic">
            No active sell orders on-chain
          </div>
        ) : (
          [...asksWithDepth].reverse().map((ask, idx) => {
            const depthPercent = Math.min(100, Math.round((ask.cumulative / maxAskDepth) * 100));
            const isSelected =
              selectedOrderKey === `${ask.utxoRef.txHash}#${ask.utxoRef.outputIndex}`;
            return (
              <div
                key={`ask-${ask.utxoRef.txHash}-${ask.utxoRef.outputIndex}-${idx}`}
                onClick={() => {
                  onSelectOrder?.(ask);
                  onSelectPrice?.(ask.effectivePrice, ask.amt);
                }}
                className={`relative grid grid-cols-3 px-3 py-1 text-xs font-mono rounded cursor-pointer transition-all group ${
                  isSelected
                    ? "bg-rose-500/25 ring-1 ring-rose-400"
                    : "hover:bg-rose-500/10"
                }`}
                title="Click to fill this order"
              >
                {/* Visual Depth Bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-rose-500/10 pointer-events-none rounded transition-all duration-300"
                  style={{ width: `${depthPercent}%` }}
                />
                <div className="relative text-rose-400 font-semibold text-left flex items-center gap-1">
                  <span>{formatPrice(ask.effectivePrice)}</span>
                  {isSelected && (
                    <span className="text-[9px] bg-rose-500/30 text-rose-200 px-1 py-0.5 rounded font-sans font-bold uppercase tracking-wider">
                      Fill
                    </span>
                  )}
                </div>
                <div className="relative text-slate-300 text-right">
                  {ask.amt.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <div className="relative text-slate-400 text-right">
                  {ask.totalQuote.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Center Bar: Spread & Latest Price */}
      <div className="px-4 py-2 border-y border-[#1f2d44] bg-[#0b0e14] flex items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-[11px]">Mid/Spread:</span>
          {orderBook.spread !== null ? (
            <span className="font-semibold text-slate-200">
              {formatPrice(orderBook.spread)} {activePair.quoteToken.symbol}
              {orderBook.spreadPercentage !== null && (
                <span className="text-slate-400 text-[10px] ml-1">
                  ({orderBook.spreadPercentage.toFixed(2)}%)
                </span>
              )}
            </span>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </div>

        <div className="flex items-center gap-1 text-[11px]">
          {orderBook.lowestAsk ? (
            <span className="text-rose-400 flex items-center">
              <ArrowDown className="w-3 h-3" /> {formatPrice(orderBook.lowestAsk)}
            </span>
          ) : null}
          {orderBook.highestBid ? (
            <span className="text-emerald-400 flex items-center ml-2">
              <ArrowUp className="w-3 h-3" /> {formatPrice(orderBook.highestBid)}
            </span>
          ) : null}
        </div>
      </div>

      {/* Bids (Buy Orders) - display highest to lowest */}
      <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
        {bidsWithDepth.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500 italic">
            No active buy orders on-chain
          </div>
        ) : (
          bidsWithDepth.map((bid, idx) => {
            const depthPercent = Math.min(100, Math.round((bid.cumulative / maxBidDepth) * 100));
            const isSelected =
              selectedOrderKey === `${bid.utxoRef.txHash}#${bid.utxoRef.outputIndex}`;
            return (
              <div
                key={`bid-${bid.utxoRef.txHash}-${bid.utxoRef.outputIndex}-${idx}`}
                onClick={() => {
                  onSelectOrder?.(bid);
                  onSelectPrice?.(bid.effectivePrice, bid.amt);
                }}
                className={`relative grid grid-cols-3 px-3 py-1 text-xs font-mono rounded cursor-pointer transition-all group ${
                  isSelected
                    ? "bg-emerald-500/25 ring-1 ring-emerald-400"
                    : "hover:bg-emerald-500/10"
                }`}
                title="Click to fill this order"
              >
                {/* Visual Depth Bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 pointer-events-none rounded transition-all duration-300"
                  style={{ width: `${depthPercent}%` }}
                />
                <div className="relative text-emerald-400 font-semibold text-left flex items-center gap-1">
                  <span>{formatPrice(bid.effectivePrice)}</span>
                  {isSelected && (
                    <span className="text-[9px] bg-emerald-500/30 text-emerald-200 px-1 py-0.5 rounded font-sans font-bold uppercase tracking-wider">
                      Fill
                    </span>
                  )}
                </div>
                <div className="relative text-slate-300 text-right">
                  {bid.amt.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <div className="relative text-slate-400 text-right">
                  {bid.totalQuote.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
