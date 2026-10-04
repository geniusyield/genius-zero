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

  const tokenA = activePair.baseToken;
  const tokenB = activePair.quoteToken;

  const formatPrice = (p: number) => {
    if (p <= 0) return "0.00";
    if (p < 0.0001) return p.toExponential(4);
    if (p < 1) return p.toFixed(6);
    return p.toFixed(4);
  };

  const getAmountNumber = (amt: bigint, decimals: number) => {
    return Number(amt) / Math.pow(10, decimals);
  };

  // Calculate cumulative depth totals for visual bars
  const asks = orderBook.asks.slice(0, 15);
  const bids = orderBook.bids.slice(0, 15);

  let askTotalAcc = 0;
  const asksWithDepth = asks.map((order) => {
    const amt = getAmountNumber(order.offeredAmount, tokenA.decimals);
    askTotalAcc += amt;
    return { ...order, amt, totalQuote: amt * order.effectivePrice, cumulative: askTotalAcc };
  });
  const maxAskDepth = askTotalAcc > 0 ? askTotalAcc : 1;

  let bidTotalAcc = 0;
  const bidsWithDepth = bids.map((order) => {
    const amt = getAmountNumber(order.offeredAmount, tokenB.decimals) / (order.effectivePrice || 1);
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
          <span className="font-semibold text-slate-300">
            {tokenA.symbol} ⇄ {tokenB.symbol}
          </span>
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
        <div className="text-left">Price Rate (Both Directions)</div>
        <div className="text-right">Available Size ({tokenA.symbol})</div>
        <div className="text-right">Value ({tokenB.symbol})</div>
      </div>

      {/* Section 1 Header: Makers Offering Token A (e.g. GENS) */}
      <div className="px-3 py-1.5 bg-[#0e141f] border-b border-[#1f2d44]/60 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-rose-300 flex items-center gap-1.5">
          <span>Offering {tokenA.symbol}</span>
          <span className="text-slate-500 font-normal">→ Want {tokenB.symbol}</span>
        </span>
        <span className="text-[10px] text-slate-400 font-mono">
          Click to <strong>Get {tokenA.symbol} & Pay {tokenB.symbol}</strong>
        </span>
      </div>

      {/* Asks (Makers offering Token A) - display highest to lowest so lowest price is adjacent to spread */}
      <div className="flex-1 overflow-y-auto flex flex-col justify-end p-1 space-y-0.5 min-h-[140px]">
        {asksWithDepth.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-500 italic">
            No active orders offering {tokenA.symbol} on-chain
          </div>
        ) : (
          [...asksWithDepth].reverse().map((ask, idx) => {
            const depthPercent = Math.min(100, Math.round((ask.cumulative / maxAskDepth) * 100));
            const isSelected =
              selectedOrderKey === `${ask.utxoRef.txHash}#${ask.utxoRef.outputIndex}`;
            const reciprocal = ask.effectivePrice > 0 ? 1 / ask.effectivePrice : 0;

            return (
              <div
                key={`ask-${ask.utxoRef.txHash}-${ask.utxoRef.outputIndex}-${idx}`}
                onClick={() => {
                  onSelectOrder?.(ask);
                  onSelectPrice?.(ask.effectivePrice, ask.amt);
                }}
                className={`relative grid grid-cols-3 px-3 py-1.5 text-xs font-mono rounded cursor-pointer transition-all group ${
                  isSelected
                    ? "bg-rose-500/25 ring-1 ring-rose-400"
                    : "hover:bg-rose-500/10"
                }`}
                title={`Click to fill: Get ${ask.amt.toFixed(2)} ${tokenA.symbol} for ${ask.totalQuote.toFixed(2)} ${tokenB.symbol}`}
              >
                {/* Visual Depth Bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-rose-500/10 pointer-events-none rounded transition-all duration-300"
                  style={{ width: `${depthPercent}%` }}
                />

                {/* Price with dual-rate subtext */}
                <div className="relative text-left flex flex-col justify-center">
                  <div className="text-rose-400 font-semibold flex items-center gap-1.5">
                    <span>{formatPrice(ask.effectivePrice)} {tokenB.symbol}</span>
                    {isSelected && (
                      <span className="text-[9px] bg-rose-500/30 text-rose-200 px-1 py-0.5 rounded font-sans font-bold uppercase tracking-wider">
                        Fill
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    (1 {tokenB.symbol} = {formatPrice(reciprocal)} {tokenA.symbol})
                  </div>
                </div>

                <div className="relative text-slate-300 text-right my-auto">
                  {ask.amt.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <div className="relative text-slate-400 text-right my-auto">
                  {ask.totalQuote.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Center Bar: Rates & Spread */}
      <div className="px-4 py-2 border-y border-[#1f2d44] bg-[#0b0e14] flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center gap-3">
          {orderBook.lowestAsk ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-400 text-[11px]">Best Rate:</span>
              <span className="font-semibold text-white">
                1 {tokenA.symbol} = {formatPrice(orderBook.lowestAsk)} {tokenB.symbol}
              </span>
              <span className="text-slate-500 text-[10px]">
                • (1 {tokenB.symbol} = {formatPrice(1 / orderBook.lowestAsk)} {tokenA.symbol})
              </span>
            </div>
          ) : (
            <span className="text-slate-500 italic text-xs">No active orders</span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span>Spread:</span>
          {orderBook.spread !== null ? (
            <span className="font-semibold text-slate-200">
              {formatPrice(orderBook.spread)} {tokenB.symbol}
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
      </div>

      {/* Section 2 Header: Makers Offering Token B (e.g. ADA) */}
      <div className="px-3 py-1.5 bg-[#0e141f] border-b border-[#1f2d44]/60 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
          <span>Offering {tokenB.symbol}</span>
          <span className="text-slate-500 font-normal">→ Want {tokenA.symbol}</span>
        </span>
        <span className="text-[10px] text-slate-400 font-mono">
          Click to <strong>Get {tokenB.symbol} & Pay {tokenA.symbol}</strong>
        </span>
      </div>

      {/* Bids (Makers offering Token B) - display highest to lowest */}
      <div className="flex-1 overflow-y-auto p-1 space-y-0.5 min-h-[140px]">
        {bidsWithDepth.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-500 italic">
            No active orders offering {tokenB.symbol} on-chain
          </div>
        ) : (
          bidsWithDepth.map((bid, idx) => {
            const depthPercent = Math.min(100, Math.round((bid.cumulative / maxBidDepth) * 100));
            const isSelected =
              selectedOrderKey === `${bid.utxoRef.txHash}#${bid.utxoRef.outputIndex}`;
            const reciprocal = bid.effectivePrice > 0 ? 1 / bid.effectivePrice : 0;

            return (
              <div
                key={`bid-${bid.utxoRef.txHash}-${bid.utxoRef.outputIndex}-${idx}`}
                onClick={() => {
                  onSelectOrder?.(bid);
                  onSelectPrice?.(bid.effectivePrice, bid.amt);
                }}
                className={`relative grid grid-cols-3 px-3 py-1.5 text-xs font-mono rounded cursor-pointer transition-all group ${
                  isSelected
                    ? "bg-emerald-500/25 ring-1 ring-emerald-400"
                    : "hover:bg-emerald-500/10"
                }`}
                title={`Click to fill: Get ${bid.totalQuote.toFixed(2)} ${tokenB.symbol} for ${bid.amt.toFixed(2)} ${tokenA.symbol}`}
              >
                {/* Visual Depth Bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 pointer-events-none rounded transition-all duration-300"
                  style={{ width: `${depthPercent}%` }}
                />

                {/* Price with dual-rate subtext */}
                <div className="relative text-left flex flex-col justify-center">
                  <div className="text-emerald-400 font-semibold flex items-center gap-1.5">
                    <span>{formatPrice(bid.effectivePrice)} {tokenB.symbol}</span>
                    {isSelected && (
                      <span className="text-[9px] bg-emerald-500/30 text-emerald-200 px-1 py-0.5 rounded font-sans font-bold uppercase tracking-wider">
                        Fill
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    (1 {tokenB.symbol} = {formatPrice(reciprocal)} {tokenA.symbol})
                  </div>
                </div>

                <div className="relative text-slate-300 text-right my-auto">
                  {bid.amt.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <div className="relative text-slate-400 text-right my-auto">
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
