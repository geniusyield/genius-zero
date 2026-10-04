import React, { useState, useEffect, useMemo } from "react";
import {
  ArrowUpDown,
  Info,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Zap,
  X,
  ArrowRight,
  Coins,
  ShieldCheck,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { DexOrder } from "../types";
import { calculateFillCost } from "../services/trade";

interface TradePanelProps {
  initialPrice?: number;
  initialAmount?: number;
  selectedOrder?: DexOrder | null;
  onClearSelectedOrder?: () => void;
  onOpenWallet: () => void;
  onOpenSettings: () => void;
}

export const TradePanel: React.FC<TradePanelProps> = ({
  initialPrice,
  initialAmount,
  selectedOrder,
  onClearSelectedOrder,
  onOpenWallet,
  onOpenSettings,
}) => {
  const {
    activePair,
    wallet,
    settings,
    placeOrder,
    fillOrder,
    actionPending,
    actionMessage,
    error,
    clearError,
  } = useApp();

  const [panelTab, setPanelTab] = useState<"fill" | "limit">("limit");
  const [orderType, setOrderType] = useState<"buy" | "sell">("buy");
  const [priceStr, setPriceStr] = useState<string>("");
  const [amountStr, setAmountStr] = useState<string>("");
  const [fillAmountStr, setFillAmountStr] = useState<string>("");
  const [submittedTx, setSubmittedTx] = useState<string | null>(null);

  // Switch automatically to "fill" tab whenever an order is clicked in the book
  useEffect(() => {
    if (selectedOrder) {
      setPanelTab("fill");
      clearError();
      setSubmittedTx(null);
      // Default to filling 100% of the offered size
      const isAsk = selectedOrder.orderType === "ask";
      const decimals = isAsk ? activePair.baseToken.decimals : activePair.quoteToken.decimals;
      const fullSize = Number(selectedOrder.offeredAmount) / Math.pow(10, decimals);
      setFillAmountStr(fullSize.toString());
    }
  }, [selectedOrder, activePair]);

  // Sync initial price from limit order selection
  useEffect(() => {
    if (initialPrice !== undefined && initialPrice > 0 && !selectedOrder) {
      setPriceStr(initialPrice.toString());
    }
  }, [initialPrice, selectedOrder]);

  useEffect(() => {
    if (initialAmount !== undefined && initialAmount > 0 && !selectedOrder) {
      setAmountStr(initialAmount.toString());
    }
  }, [initialAmount, selectedOrder]);

  // Available user balances
  const userAdaBalance = Number(wallet.balanceLovelace) / 1_000_000;
  const userBaseTokenBalance =
    activePair.baseToken.unit === "lovelace"
      ? userAdaBalance
      : Number(wallet.tokenBalances[activePair.baseToken.unit] || 0n) /
        Math.pow(10, activePair.baseToken.decimals);

  // --- LIMIT ORDER LOGIC ---
  const priceNum = parseFloat(priceStr) || 0;
  const amountNum = parseFloat(amountStr) || 0;
  const totalQuote = priceNum * amountNum;

  const makerFlatFeeAda = 1.0;
  const makerPercentFee = orderType === "sell" ? amountNum * 0.003 : totalQuote * 0.003;
  const orderDepositAda = 2.1;

  const handleLimitPercentage = (pct: number) => {
    clearError();
    if (orderType === "buy") {
      const spendableAda = Math.max(0, userAdaBalance - 3.5);
      const targetAda = spendableAda * (pct / 100);
      if (priceNum > 0) {
        setAmountStr((targetAda / priceNum).toFixed(2));
      }
    } else {
      const targetTokens = userBaseTokenBalance * (pct / 100);
      setAmountStr(targetTokens.toFixed(2));
    }
  };

  const handleLimitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setSubmittedTx(null);

    if (!settings.blockfrostApiKey) {
      onOpenSettings();
      return;
    }
    if (!wallet.connected) {
      onOpenWallet();
      return;
    }
    if (amountNum <= 0 || priceNum <= 0) return;

    try {
      const txHash = await placeOrder({
        orderType,
        amount: amountNum,
        price: priceNum,
      });
      setSubmittedTx(txHash);
      setAmountStr("");
    } catch (err) {
      console.error(err);
    }
  };

  // --- FILL ORDER LOGIC ---
  const fillDetails = useMemo(() => {
    if (!selectedOrder) return null;

    const isAsk = selectedOrder.orderType === "ask";
    const offeredDecimals = isAsk ? activePair.baseToken.decimals : activePair.quoteToken.decimals;
    const askedDecimals = isAsk ? activePair.quoteToken.decimals : activePair.baseToken.decimals;
    const offeredSymbol = isAsk ? activePair.baseToken.symbol : activePair.quoteToken.symbol;
    const askedSymbol = isAsk ? activePair.quoteToken.symbol : activePair.baseToken.symbol;

    const maxOfferedTokens = Number(selectedOrder.offeredAmount) / Math.pow(10, offeredDecimals);
    const parsedInput = parseFloat(fillAmountStr) || 0;
    const boundedInput = Math.min(Math.max(0, parsedInput), maxOfferedTokens);

    let fillAmountRaw: bigint;
    if (boundedInput >= maxOfferedTokens || parsedInput >= maxOfferedTokens) {
      fillAmountRaw = selectedOrder.offeredAmount;
    } else {
      fillAmountRaw = BigInt(Math.floor(boundedInput * Math.pow(10, offeredDecimals)));
    }

    const cost = calculateFillCost(selectedOrder, fillAmountRaw);
    const payFormatted = Number(cost.payAmount) / Math.pow(10, askedDecimals);
    const receiveFormatted = Number(cost.receiveAmount) / Math.pow(10, offeredDecimals);

    // Balance verification
    let hasSufficientBalance = false;
    if (isAsk) {
      // Taker pays ADA (quote) and gets base token
      // Taker needs: payAmount in Lovelace + 1.0 ADA taker flat fee + ~0.35 ADA network fee
      const reqLovelace = cost.payAmount + cost.takerFeeLovelace + 350_000n;
      hasSufficientBalance = wallet.balanceLovelace >= reqLovelace;
    } else {
      // Taker pays base token and gets ADA
      // Taker needs: payAmount in base tokens, plus 1.0 ADA taker fee + ~0.35 ADA network fee
      const userTokenRaw =
        activePair.baseToken.unit === "lovelace"
          ? wallet.balanceLovelace
          : wallet.tokenBalances[activePair.baseToken.unit] || 0n;
      const reqLovelace = cost.takerFeeLovelace + 350_000n;
      hasSufficientBalance =
        userTokenRaw >= cost.payAmount && wallet.balanceLovelace >= reqLovelace;
    }

    return {
      isAsk,
      offeredDecimals,
      askedDecimals,
      offeredSymbol,
      askedSymbol,
      maxOfferedTokens,
      fillAmountRaw,
      cost,
      payFormatted,
      receiveFormatted,
      isComplete: cost.isComplete,
      hasSufficientBalance,
    };
  }, [selectedOrder, fillAmountStr, activePair, wallet]);

  const handleFillPercentage = (pct: number) => {
    if (!selectedOrder || !fillDetails) return;
    clearError();
    if (pct === 100) {
      setFillAmountStr(fillDetails.maxOfferedTokens.toString());
    } else {
      const portion = (fillDetails.maxOfferedTokens * pct) / 100;
      setFillAmountStr(portion.toFixed(2));
    }
  };

  const handleFillSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setSubmittedTx(null);

    if (!settings.blockfrostApiKey) {
      onOpenSettings();
      return;
    }
    if (!wallet.connected) {
      onOpenWallet();
      return;
    }
    if (!selectedOrder || !fillDetails) return;
    if (fillDetails.fillAmountRaw <= 0n) return;

    try {
      const txHash = await fillOrder(
        selectedOrder,
        fillDetails.isComplete ? undefined : fillDetails.fillAmountRaw
      );
      setSubmittedTx(txHash);
      onClearSelectedOrder?.();
    } catch (err) {
      console.error(err);
    }
  };

  const explorerBaseUrl =
    settings.network === "mainnet"
      ? "https://cardanoscan.io/transaction"
      : "https://preprod.cardanoscan.io/transaction";

  return (
    <div className="bg-[#121824] border border-[#1f2d44] rounded-2xl overflow-hidden shadow-xl p-5 flex flex-col h-full">
      {/* Mode Switcher Tabs: Limit Order vs Fill Order */}
      <div className="flex items-center gap-1.5 p-1 bg-[#0b0e14] rounded-xl mb-4 border border-[#1f2d44]/50">
        <button
          type="button"
          onClick={() => {
            setPanelTab("limit");
            clearError();
          }}
          className={`flex-1 py-2 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
            panelTab === "limit"
              ? "bg-[#1f2d44] text-white shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <Coins className="w-3.5 h-3.5" />
          <span>Place Limit Order</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setPanelTab("fill");
            clearError();
          }}
          className={`flex-1 py-2 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
            panelTab === "fill"
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>Fill Order</span>
          {selectedOrder && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* MODE 1: FILL SELECTED ORDER                                              */}
      {/* ========================================================================= */}
      {panelTab === "fill" && (
        <div className="flex-1 flex flex-col">
          {!selectedOrder ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-[#1f2d44] rounded-xl text-slate-400 space-y-3 my-auto">
              <Zap className="w-8 h-8 text-amber-400/80 animate-bounce" />
              <div className="space-y-1">
                <div className="text-sm font-semibold text-white">No Order Selected</div>
                <div className="text-xs text-slate-400 max-w-[220px]">
                  Click on any buy or sell order in the Order Book to instantly fill it!
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPanelTab("limit")}
                className="px-3 py-1.5 rounded-lg bg-[#182234] hover:bg-[#1f2d44] text-xs font-semibold text-slate-300 transition-colors"
              >
                Or Place a Limit Order
              </button>
            </div>
          ) : (
            fillDetails && (
              <form onSubmit={handleFillSubmit} className="space-y-4 flex-1 flex flex-col">
                {/* Active Selected Order Header */}
                <div className="p-3 rounded-xl bg-[#0b0e14] border border-[#1f2d44] flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        fillDetails.isAsk
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      }`}
                    >
                      {fillDetails.isAsk ? "Sell Order (Ask)" : "Buy Order (Bid)"}
                    </span>
                    <span className="text-slate-400">
                      @ <strong className="text-white font-mono">{selectedOrder.effectivePrice.toFixed(4)}</strong> {activePair.quoteToken.symbol}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onClearSelectedOrder?.();
                      setPanelTab("limit");
                    }}
                    className="p-1 rounded hover:bg-[#1f2d44] text-slate-400 hover:text-white transition-colors"
                    title="Deselect Order"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* You are: Buying / Selling indicator */}
                <div className="p-3 rounded-xl bg-gradient-to-r from-[#142032] to-[#121824] border border-[#223552] text-xs">
                  <div className="text-slate-400 text-[11px] mb-1">Fill Action:</div>
                  <div className="flex items-center gap-2 font-bold text-white text-sm">
                    <span className={fillDetails.isAsk ? "text-emerald-400" : "text-rose-400"}>
                      {fillDetails.isAsk ? `Buy ${activePair.baseToken.symbol}` : `Sell ${activePair.baseToken.symbol}`}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-slate-300 font-normal text-xs">
                      from maker <span className="font-mono text-slate-400">{selectedOrder.ownerAddress.slice(0, 8)}...</span>
                    </span>
                  </div>
                </div>

                {/* Amount to Fill */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <label className="font-semibold flex items-center gap-1.5">
                      <span>Fill Amount</span>
                      <span className="text-slate-500 font-mono">({fillDetails.offeredSymbol})</span>
                    </label>
                    <span className="text-[11px] text-slate-400">
                      Available: <strong className="text-white font-mono">{fillDetails.maxOfferedTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                    </span>
                  </div>

                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      max={fillDetails.maxOfferedTokens}
                      value={fillAmountStr}
                      onChange={(e) => setFillAmountStr(e.target.value)}
                      placeholder="0.00"
                      required
                      className="w-full px-4 py-2.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] text-white text-sm font-mono focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>

                {/* Fill Percentage Shortcuts */}
                <div className="grid grid-cols-4 gap-2">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => handleFillPercentage(pct)}
                      className={`py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                        pct === 100
                          ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/40"
                          : "bg-[#182234] border-[#1f2d44] hover:border-slate-600 text-slate-300"
                      }`}
                    >
                      {pct === 100 ? "100% (All)" : `${pct}%`}
                    </button>
                  ))}
                </div>

                {/* Breakdown Card */}
                <div className="p-3.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-2 text-xs font-mono">
                  <div className="flex items-center justify-between text-slate-300">
                    <span>You Pay:</span>
                    <span className="font-bold text-rose-400">
                      {fillDetails.payFormatted.toFixed(4)} {fillDetails.askedSymbol}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-300">
                    <span>You Receive:</span>
                    <span className="font-bold text-emerald-400">
                      +{fillDetails.receiveFormatted.toFixed(4)} {fillDetails.offeredSymbol}
                    </span>
                  </div>

                  <div className="border-t border-[#1f2d44] pt-2 space-y-1 text-[11px] text-slate-400">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        Taker Protocol Fee:
                        <span title="Fixed Genius Yield taker fee" className="text-slate-500 cursor-help">ⓘ</span>
                      </span>
                      <span>1.00 ADA</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span>Execution Type:</span>
                      <span className={fillDetails.isComplete ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}>
                        {fillDetails.isComplete ? "Complete Fill (Burn NFT)" : "Partial Fill (Leave Rest)"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Available Balance Status */}
                <div className="text-[11px] flex items-center justify-between text-slate-400 px-1">
                  <span>Your Balance:</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {fillDetails.isAsk
                      ? `${userAdaBalance.toFixed(2)} ADA`
                      : `${userBaseTokenBalance.toFixed(2)} ${activePair.baseToken.symbol}`}
                  </span>
                </div>

                {!fillDetails.hasSufficientBalance && (
                  <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-600/40 text-amber-200 text-xs">
                    ⚠️ Insufficient balance to cover payment and 1.0 ADA taker fee.
                  </div>
                )}

                {/* Alerts / Success Message */}
                {submittedTx && (
                  <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-xs flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                    <div className="space-y-1 overflow-hidden">
                      <div className="font-bold">Order Fill Submitted!</div>
                      <a
                        href={`${explorerBaseUrl}/${submittedTx}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1 font-mono truncate"
                      >
                        View on Cardanoscan <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs">
                    {error}
                  </div>
                )}

                {/* Action Button */}
                <div className="pt-2 mt-auto">
                  {!settings.blockfrostApiKey ? (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-amber-500/20"
                    >
                      Configure Blockfrost Key
                    </button>
                  ) : !wallet.connected ? (
                    <button
                      type="button"
                      onClick={onOpenWallet}
                      className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-emerald-500/20"
                    >
                      Connect Wallet to Fill
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={
                        actionPending ||
                        fillDetails.fillAmountRaw <= 0n ||
                        !fillDetails.hasSufficientBalance
                      }
                      className="w-full py-3 rounded-xl font-bold text-sm transition-all shadow-lg flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-emerald-500/20 disabled:bg-emerald-500/40 disabled:cursor-not-allowed"
                    >
                      {actionPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>{actionMessage || "Processing Fill..."}</span>
                        </>
                      ) : (
                        <span>
                          {fillDetails.isComplete
                            ? "Complete Fill Order"
                            : `Partial Fill (${fillDetails.receiveFormatted.toFixed(2)} ${fillDetails.offeredSymbol})`}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </form>
            )
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 2: PLACE LIMIT ORDER                                                */}
      {/* ========================================================================= */}
      {panelTab === "limit" && (
        <div className="flex-1 flex flex-col">
          {/* Buy / Sell Tabs */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-[#0b0e14] rounded-xl mb-4">
            <button
              type="button"
              onClick={() => {
                setOrderType("buy");
                clearError();
              }}
              className={`py-2 rounded-lg font-bold text-xs transition-all ${
                orderType === "buy"
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Buy {activePair.baseToken.symbol}
            </button>
            <button
              type="button"
              onClick={() => {
                setOrderType("sell");
                clearError();
              }}
              className={`py-2 rounded-lg font-bold text-xs transition-all ${
                orderType === "sell"
                  ? "bg-rose-500 text-white shadow-md shadow-rose-500/20"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Sell {activePair.baseToken.symbol}
            </button>
          </div>

          <form onSubmit={handleLimitSubmit} className="space-y-4 flex-1 flex flex-col">
            {/* Available Balance */}
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Available:</span>
              <span className="font-mono text-slate-200 font-semibold">
                {orderType === "buy"
                  ? `${userAdaBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} ADA`
                  : `${userBaseTokenBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${activePair.baseToken.symbol}`}
              </span>
            </div>

            {/* Price Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Price</span>
                <span className="text-slate-500">{activePair.quoteToken.symbol}</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={priceStr}
                  onChange={(e) => setPriceStr(e.target.value)}
                  placeholder="0.00"
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] text-white text-sm font-mono focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>

            {/* Amount Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Amount</span>
                <span className="text-slate-500">{activePair.baseToken.symbol}</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="0.00"
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] text-white text-sm font-mono focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>

            {/* Balance Percentage Shortcuts */}
            <div className="grid grid-cols-4 gap-2">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => handleLimitPercentage(pct)}
                  className="py-1 rounded-lg bg-[#182234] border border-[#1f2d44] hover:border-slate-600 text-[11px] font-semibold text-slate-300 transition-colors"
                >
                  {pct}%
                </button>
              ))}
            </div>

            {/* Total & Fee Breakdown */}
            <div className="p-3.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between text-slate-300">
                <span>Order Value:</span>
                <span className="font-bold text-white">
                  {totalQuote.toFixed(4)} {activePair.quoteToken.symbol}
                </span>
              </div>

              <div className="border-t border-[#1f2d44] pt-2 space-y-1 text-[11px] text-slate-400">
                <div className="flex items-center justify-between">
                  <span>Maker Flat Fee:</span>
                  <span>{makerFlatFeeAda.toFixed(2)} ADA</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Maker Fee Ratio (0.3%):</span>
                  <span>
                    {makerPercentFee.toFixed(4)}{" "}
                    {orderType === "sell"
                      ? activePair.baseToken.symbol
                      : activePair.quoteToken.symbol}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    Order Deposit:
                    <span title="Locked in the order UTxO, fully refunded upon cancel or fill" className="text-slate-500 cursor-help">ⓘ</span>
                  </span>
                  <span>~{orderDepositAda.toFixed(2)} ADA (refundable)</span>
                </div>
              </div>
            </div>

            {/* Alerts / Success Message */}
            {submittedTx && (
              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-xs flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                <div className="space-y-1 overflow-hidden">
                  <div className="font-bold">Limit Order Placed!</div>
                  <a
                    href={`${explorerBaseUrl}/${submittedTx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1 font-mono truncate"
                  >
                    View on Cardanoscan <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <div className="pt-2 mt-auto">
              {!settings.blockfrostApiKey ? (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-amber-500/20"
                >
                  Configure Blockfrost Key
                </button>
              ) : !wallet.connected ? (
                <button
                  type="button"
                  onClick={onOpenWallet}
                  className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-emerald-500/20"
                >
                  Connect Wallet to Trade
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={actionPending || amountNum <= 0 || priceNum <= 0}
                  className={`w-full py-3 rounded-xl font-bold text-sm transition-all shadow-lg flex items-center justify-center gap-2 ${
                    orderType === "buy"
                      ? "bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-emerald-500/20 disabled:bg-emerald-500/40"
                      : "bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/20 disabled:bg-rose-500/40"
                  }`}
                >
                  {actionPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{actionMessage || "Processing Transaction..."}</span>
                    </>
                  ) : (
                    <span>
                      Place {orderType === "buy" ? "Buy" : "Sell"} Order
                    </span>
                  )}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
