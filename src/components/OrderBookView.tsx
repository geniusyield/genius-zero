import React from "react";
import { ArrowUp, ArrowDown, Activity, RefreshCw, ExternalLink } from "lucide-react";
import { useApp } from "../context/AppContext";
import { DexOrder } from "../types";
import { ProgressBar } from "./ProgressBar";
import { formatMinswapRate } from "../services/minswap";

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
  const {
    orderBook,
    activePair,
    loadingOrderBook,
    orderBookProgress,
    cancelRefreshOrderBook,
    minswapPrice,
    loadingMinswapPrice,
    refreshMinswapPrice,
  } = useApp();

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
    const availableOffered = getAmountNumber(order.offeredAmount, tokenA.decimals);
    const costToPay = availableOffered * order.effectivePrice;
    askTotalAcc += availableOffered;
    return {
      ...order,
      availableOffered,
      costToPay,
      cumulative: askTotalAcc,
    };
  });
  const maxAskDepth = askTotalAcc > 0 ? askTotalAcc : 1;

  let bidTotalAcc = 0;
  const bidsWithDepth = bids.map((order) => {
    const availableOffered = getAmountNumber(order.offeredAmount, tokenB.decimals);
    const costToPay =
      order.effectivePrice > 0 ? availableOffered / order.effectivePrice : 0;
    bidTotalAcc += availableOffered;
    return {
      ...order,
      availableOffered,
      costToPay,
      cumulative: bidTotalAcc,
    };
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

      {/* Section 1 Header: Makers Offering Token A (e.g. GENS) */}
      <div className="px-3 py-1.5 bg-[#0e141f] border-b border-[#1f2d44]/60 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-rose-300 flex items-center gap-1.5">
          <span>Offering {tokenA.symbol}</span>
          <span className="text-slate-500 font-normal">→ Want {tokenB.symbol}</span>
        </span>
        <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
          Click order to <strong>Get {tokenA.symbol} &amp; Pay {tokenB.symbol}</strong>
        </span>
      </div>

      {/* Section 1 Dedicated Column Titles */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b border-[#1f2d44]/40 bg-[#090d14]">
        <div className="text-left text-slate-400">
          <span className="hidden sm:inline">1 {tokenA.symbol} in {tokenB.symbol}</span>
          <span className="sm:hidden">Price ({tokenB.symbol})</span>
        </div>
        <div className="hidden sm:block text-right text-slate-400">1 {tokenB.symbol} in {tokenA.symbol}</div>
        <div className="text-right text-rose-300/90">
          <span className="hidden sm:inline">Available to Get ({tokenA.symbol})</span>
          <span className="sm:hidden">Get ({tokenA.symbol})</span>
        </div>
        <div className="text-right text-slate-400">
          <span className="hidden sm:inline">Cost to Pay ({tokenB.symbol})</span>
          <span className="sm:hidden">Pay ({tokenB.symbol})</span>
        </div>
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
            const askKey = `${ask.utxoRef.txHash}#${ask.utxoRef.outputIndex}${ask.vaultDirection ? `:${ask.vaultDirection}` : ""}`;
            const isSelected =
              selectedOrderKey === askKey ||
              (!ask.vaultDirection && selectedOrderKey === `${ask.utxoRef.txHash}#${ask.utxoRef.outputIndex}`);
            const reciprocal = ask.effectivePrice > 0 ? 1 / ask.effectivePrice : 0;

            return (
              <div
                key={`ask-${ask.utxoRef.txHash}-${ask.utxoRef.outputIndex}-${ask.vaultDirection || "order"}-${idx}`}
                onClick={() => {
                  onSelectOrder?.(ask);
                  onSelectPrice?.(ask.effectivePrice, ask.availableOffered);
                }}
                className={`relative grid grid-cols-3 sm:grid-cols-4 gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-mono rounded cursor-pointer transition-all group ${
                  isSelected
                    ? "bg-rose-500/25 ring-1 ring-rose-400"
                    : ask.isVault
                    ? "hover:bg-cyan-500/10 border-l-2 border-cyan-400/80 bg-cyan-950/10"
                    : "hover:bg-rose-500/10"
                }`}
                title={`${ask.isVault ? `[Smart Liquidity Vault (SLV)${ask.isDynamicOracle ? " • Dynamic Oracle" : " • Fixed"}]\n` : ""}Click to fill: Get ${ask.availableOffered.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${tokenA.symbol} for ${ask.costToPay.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${tokenB.symbol}\nRate: 1 ${tokenA.symbol} = ${formatPrice(ask.effectivePrice)} ${tokenB.symbol} | 1 ${tokenB.symbol} = ${formatPrice(reciprocal)} ${tokenA.symbol}`}
              >
                {/* Visual Depth Bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-rose-500/10 pointer-events-none rounded transition-all duration-300"
                  style={{ width: `${depthPercent}%` }}
                />

                {/* Col 1: 1 Token A in Token B */}
                <div className="relative text-left flex items-center gap-1 font-semibold text-rose-400 truncate">
                  <span>{formatPrice(ask.effectivePrice)}</span>
                  <span className="text-[9px] sm:text-[10px] text-rose-300/70 font-normal">{tokenB.symbol}</span>
                  {ask.isVault && (
                    <span
                      className="text-[8px] sm:text-[9px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 px-1 py-0.2 rounded font-sans font-bold uppercase tracking-wider shrink-0"
                      title={ask.isDynamicOracle ? "Smart Liquidity Vault (Dynamic Oracle rate)" : "Smart Liquidity Vault (Fixed rate)"}
                    >
                      SLV{ask.isDynamicOracle ? " • O" : ""}
                    </span>
                  )}
                  {isSelected && (
                    <span className="text-[8px] sm:text-[9px] bg-rose-500/30 text-rose-200 px-1 py-0.5 rounded font-sans font-bold uppercase tracking-wider shrink-0">
                      Fill
                    </span>
                  )}
                </div>

                {/* Col 2: Reciprocal: 1 Token B in Token A (Desktop only) */}
                <div className="hidden sm:block relative text-right my-auto text-slate-400">
                  <span>{formatPrice(reciprocal)}</span>
                  <span className="text-[10px] text-slate-500 ml-1">{tokenA.symbol}</span>
                </div>

                {/* Col 3: Available to Get (Token A) */}
                <div className="relative text-slate-200 text-right my-auto font-medium truncate">
                  {ask.availableOffered.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  <span className="text-[9px] sm:text-[10px] text-slate-400 ml-1">{tokenA.symbol}</span>
                </div>

                {/* Col 4: Cost to Pay (Token B) */}
                <div className="relative text-slate-400 text-right my-auto truncate">
                  {ask.costToPay.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  <span className="text-[9px] sm:text-[10px] text-slate-500 ml-1">{tokenB.symbol}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Center Bar: Rates, Spread & Minswap Comparison */}
      <div className="border-y border-[#1f2d44] bg-[#0b0e14] divide-y divide-[#1f2d44]/60">
        {/* Row 1: Genius Yield Best Offer & Spread */}
        <div className="px-3 sm:px-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs font-mono">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-400 text-[11px] font-sans font-semibold">GY Best Offer:</span>
            {orderBook.lowestAsk ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-rose-300">
                  1 {tokenA.symbol} = {formatPrice(orderBook.lowestAsk)} {tokenB.symbol}
                </span>
                <span className="text-slate-500 text-[10px] hidden sm:inline">
                  (1 {tokenB.symbol} = {formatPrice(1 / orderBook.lowestAsk)} {tokenA.symbol})
                </span>
              </div>
            ) : (
              <span className="text-slate-500 italic text-xs font-sans">No active orders</span>
            )}
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="font-sans font-semibold">Spread:</span>
            {orderBook.spread !== null ? (
              orderBook.spread < 0 ? (
                <span className="font-bold text-amber-300 flex items-center gap-1.5 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/40 animate-pulse text-[10px] sm:text-xs">
                  <span>⚡ Arbitrage:</span>
                  <span>{formatPrice(Math.abs(orderBook.spread))} {tokenB.symbol}</span>
                  {orderBook.spreadPercentage !== null && (
                    <span className="text-[10px]">({Math.abs(orderBook.spreadPercentage).toFixed(1)}%)</span>
                  )}
                </span>
              ) : (
                <span className="font-semibold text-slate-200">
                  {formatPrice(orderBook.spread)} {tokenB.symbol}
                  {orderBook.spreadPercentage !== null && (
                    <span className="text-slate-400 text-[10px] ml-1">
                      ({orderBook.spreadPercentage.toFixed(1)}%)
                    </span>
                  )}
                </span>
              )
            ) : (
              <span className="text-slate-600">—</span>
            )}
          </div>
        </div>

        {/* Row 2: Minswap Reference Rate (In Both Directions) */}
        <div className="px-3 sm:px-4 py-1.5 bg-[#0e1422] flex flex-wrap items-center justify-between gap-1.5 text-[11px] font-mono">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-400 font-sans font-bold text-[10px]">
              <ExternalLink className="w-3 h-3" />
              <span>Minswap:</span>
            </div>
            {minswapPrice && minswapPrice.available ? (
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap text-[10px] sm:text-[11px]">
                <span className="text-white font-semibold">
                  1 {tokenA.symbol} = {formatMinswapRate(minswapPrice.priceBaseInQuote)} {tokenB.symbol}
                </span>
                <span className="text-slate-500">⇄</span>
                <span className="text-slate-300">
                  1 {tokenB.symbol} = {formatMinswapRate(minswapPrice.priceQuoteInBase)} {tokenA.symbol}
                </span>
                {orderBook.lowestAsk && minswapPrice.priceBaseInQuote > 0 && (
                  (() => {
                    const diffPercent =
                      ((orderBook.lowestAsk - minswapPrice.priceBaseInQuote) /
                        minswapPrice.priceBaseInQuote) *
                      100;
                    const isHigher = diffPercent > 0;
                    return (
                      <span
                        className={`text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded font-sans font-semibold ${
                          isHigher
                            ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                            : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                        }`}
                        title={`Genius Yield lowest ask is ${Math.abs(diffPercent).toFixed(1)}% ${isHigher ? "higher" : "lower"} than Minswap`}
                      >
                        GY Ask {isHigher ? `+${diffPercent.toFixed(1)}%` : `${diffPercent.toFixed(1)}%`}
                      </span>
                    );
                  })()
                )}
              </div>
            ) : (
              <span className="text-slate-500 italic text-[11px] font-sans">
                {loadingMinswapPrice ? "Fetching Minswap rate..." : (minswapPrice?.error || "Minswap rate unavailable")}
              </span>
            )}
          </div>

          <button
            onClick={refreshMinswapPrice}
            disabled={loadingMinswapPrice}
            type="button"
            title="Refresh Minswap rate"
            className="text-slate-400 hover:text-blue-400 transition-colors p-1 rounded hover:bg-[#1f2d44]"
          >
            <RefreshCw className={`w-3 h-3 ${loadingMinswapPrice ? "animate-spin text-blue-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* Section 2 Header: Makers Offering Token B (e.g. ADA) */}
      <div className="px-3 py-1.5 bg-[#0e141f] border-b border-[#1f2d44]/60 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
          <span>Offering {tokenB.symbol}</span>
          <span className="text-slate-500 font-normal">→ Want {tokenA.symbol}</span>
        </span>
        <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
          Click order to <strong>Get {tokenB.symbol} &amp; Pay {tokenA.symbol}</strong>
        </span>
      </div>

      {/* Section 2 Dedicated Column Titles */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b border-[#1f2d44]/40 bg-[#090d14]">
        <div className="text-left text-slate-400">
          <span className="hidden sm:inline">1 {tokenA.symbol} in {tokenB.symbol}</span>
          <span className="sm:hidden">Price ({tokenB.symbol})</span>
        </div>
        <div className="hidden sm:block text-right text-slate-400">1 {tokenB.symbol} in {tokenA.symbol}</div>
        <div className="text-right text-emerald-300/90">
          <span className="hidden sm:inline">Available to Get ({tokenB.symbol})</span>
          <span className="sm:hidden">Get ({tokenB.symbol})</span>
        </div>
        <div className="text-right text-slate-400">
          <span className="hidden sm:inline">Cost to Pay ({tokenA.symbol})</span>
          <span className="sm:hidden">Pay ({tokenA.symbol})</span>
        </div>
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
            const bidKey = `${bid.utxoRef.txHash}#${bid.utxoRef.outputIndex}${bid.vaultDirection ? `:${bid.vaultDirection}` : ""}`;
            const isSelected =
              selectedOrderKey === bidKey ||
              (!bid.vaultDirection && selectedOrderKey === `${bid.utxoRef.txHash}#${bid.utxoRef.outputIndex}`);
            const reciprocal = bid.effectivePrice > 0 ? 1 / bid.effectivePrice : 0;

            return (
              <div
                key={`bid-${bid.utxoRef.txHash}-${bid.utxoRef.outputIndex}-${bid.vaultDirection || "order"}-${idx}`}
                onClick={() => {
                  onSelectOrder?.(bid);
                  onSelectPrice?.(bid.effectivePrice, bid.availableOffered);
                }}
                className={`relative grid grid-cols-3 sm:grid-cols-4 gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-mono rounded cursor-pointer transition-all group ${
                  isSelected
                    ? "bg-emerald-500/25 ring-1 ring-emerald-400"
                    : bid.isVault
                    ? "hover:bg-cyan-500/10 border-l-2 border-cyan-400/80 bg-cyan-950/10"
                    : "hover:bg-emerald-500/10"
                }`}
                title={`${bid.isVault ? `[Smart Liquidity Vault (SLV)${bid.isDynamicOracle ? " • Dynamic Oracle" : " • Fixed"}]\n` : ""}Click to fill: Get ${bid.availableOffered.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${tokenB.symbol} for ${bid.costToPay.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${tokenA.symbol}\nRate: 1 ${tokenA.symbol} = ${formatPrice(bid.effectivePrice)} ${tokenB.symbol} | 1 ${tokenB.symbol} = ${formatPrice(reciprocal)} ${tokenA.symbol}`}
              >
                {/* Visual Depth Bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 pointer-events-none rounded transition-all duration-300"
                  style={{ width: `${depthPercent}%` }}
                />

                {/* Col 1: 1 Token A in Token B */}
                <div className="relative text-left flex items-center gap-1 font-semibold text-emerald-400 truncate">
                  <span>{formatPrice(bid.effectivePrice)}</span>
                  <span className="text-[9px] sm:text-[10px] text-emerald-300/70 font-normal">{tokenB.symbol}</span>
                  {bid.isVault && (
                    <span
                      className="text-[8px] sm:text-[9px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 px-1 py-0.2 rounded font-sans font-bold uppercase tracking-wider shrink-0"
                      title={bid.isDynamicOracle ? "Smart Liquidity Vault (Dynamic Oracle rate)" : "Smart Liquidity Vault (Fixed rate)"}
                    >
                      SLV{bid.isDynamicOracle ? " • O" : ""}
                    </span>
                  )}
                  {isSelected && (
                    <span className="text-[8px] sm:text-[9px] bg-emerald-500/30 text-emerald-200 px-1 py-0.5 rounded font-sans font-bold uppercase tracking-wider shrink-0">
                      Fill
                    </span>
                  )}
                </div>

                {/* Col 2: Reciprocal: 1 Token B in Token A (Desktop only) */}
                <div className="hidden sm:block relative text-right my-auto text-slate-400">
                  <span>{formatPrice(reciprocal)}</span>
                  <span className="text-[10px] text-slate-500 ml-1">{tokenA.symbol}</span>
                </div>

                {/* Col 3: Available to Get (Token B) */}
                <div className="relative text-slate-200 text-right my-auto font-medium truncate">
                  {bid.availableOffered.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  <span className="text-[9px] sm:text-[10px] text-slate-400 ml-1">{tokenB.symbol}</span>
                </div>

                {/* Col 4: Cost to Pay (Token A) */}
                <div className="relative text-slate-400 text-right my-auto truncate">
                  {bid.costToPay.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  <span className="text-[9px] sm:text-[10px] text-slate-500 ml-1">{tokenA.symbol}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
