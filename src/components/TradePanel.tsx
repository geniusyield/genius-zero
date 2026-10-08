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
  ArrowDownUp,
  Coins,
  ShieldCheck,
  Check,
  AlertTriangle,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { DexOrder } from "../types";
import { calculateFillCost } from "../services/trade";
import { parseTokenUnits, formatTokenUnits } from "../contracts/utils";
import { formatMinswapRate } from "../services/minswap";

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
    minswapPrice,
    loadingMinswapPrice,
  } = useApp();

  const tokenA = activePair.baseToken;
  const tokenB = activePair.quoteToken;

  const [panelTab, setPanelTab] = useState<"create" | "fill">("create");

  // In Create Order mode: which token is the maker depositing?
  // "base" = maker deposits Token A (e.g. GENS) and receives Token B (e.g. ADA)
  // "quote" = maker deposits Token B (e.g. ADA) and receives Token A (e.g. GENS)
  const [depositAsset, setDepositAsset] = useState<"base" | "quote">("base");
  const [depositAmountStr, setDepositAmountStr] = useState<string>("");
  // Rate input: can be quoted as B per A, or flipped as A per B
  const [rateStr, setRateStr] = useState<string>("");
  const [rateIsFlipped, setRateIsFlipped] = useState<boolean>(false);

  // In Fill Order mode:
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
      const decimals = isAsk ? tokenA.decimals : tokenB.decimals;
      const fullSize = Number(selectedOrder.offeredAmount) / Math.pow(10, decimals);
      setFillAmountStr(fullSize.toString());
    }
  }, [selectedOrder, tokenA, tokenB]);

  // Sync initial price from orderbook click when in create mode
  useEffect(() => {
    if (initialPrice !== undefined && initialPrice > 0 && !selectedOrder) {
      setRateStr(initialPrice.toString());
    }
  }, [initialPrice, selectedOrder]);

  useEffect(() => {
    if (initialAmount !== undefined && initialAmount > 0 && !selectedOrder) {
      setDepositAmountStr(initialAmount.toString());
    }
  }, [initialAmount, selectedOrder]);

  // Available user balances
  const userAdaBalance = Number(wallet.balanceLovelace) / 1_000_000;
  const userTokenABalance =
    tokenA.unit === "lovelace"
      ? userAdaBalance
      : Number(wallet.tokenBalances[tokenA.unit] || 0n) / Math.pow(10, tokenA.decimals);
  const userTokenBBalance =
    tokenB.unit === "lovelace"
      ? userAdaBalance
      : Number(wallet.tokenBalances[tokenB.unit] || 0n) / Math.pow(10, tokenB.decimals);

  // Deposit vs Receive tokens
  const offeredToken = depositAsset === "base" ? tokenA : tokenB;
  const askedToken = depositAsset === "base" ? tokenB : tokenA;
  const userOfferedBalance = depositAsset === "base" ? userTokenABalance : userTokenBBalance;

  // --- CREATE ORDER CALCULATIONS ---
  // Standard price is always: 1 Token A = X Token B
  const parsedRateInput = parseFloat(rateStr) || 0;
  const priceBperA = rateIsFlipped
    ? parsedRateInput > 0
      ? 1 / parsedRateInput
      : 0
    : parsedRateInput;
  const priceAperB = priceBperA > 0 ? 1 / priceBperA : 0;

  const depositAmountNum = parseFloat(depositAmountStr) || 0;

  // Calculate asked amount based on deposit and rate:
  // If depositing Token A: receive Token B = depositAmount * priceBperA
  // If depositing Token B: receive Token A = depositAmount / priceBperA (or depositAmount * priceAperB)
  const calculatedReceiveAmount =
    depositAsset === "base"
      ? depositAmountNum * priceBperA
      : depositAmountNum * priceAperB;

  // Fee calculation for creating an order:
  // Maker flat fee: 1.0 ADA
  // Maker percentage fee: 0.3% of offered amount
  const makerFlatFeeAda = 1.0;
  const makerPercentFee = depositAmountNum * 0.003;
  const orderDepositAda = 2.1; // Refundable

  // Check if wallet has enough for deposit + fees
  const hasSufficientDepositBalance = useMemo(() => {
    if (!wallet.connected) return true;
    if (offeredToken.unit === "lovelace") {
      // Depositing ADA: needs depositAmount + makerFlatFee + makerPercentFee + orderDeposit + network fee (~0.35)
      const totalAdaNeeded =
        depositAmountNum + makerFlatFeeAda + makerPercentFee + orderDepositAda + 0.35;
      return userAdaBalance >= totalAdaNeeded;
    } else {
      // Depositing non-ADA: needs depositAmount + 0.3% in tokens, PLUS ~3.45 ADA in wallet for fees/deposit
      const totalTokenNeeded = depositAmountNum + makerPercentFee;
      const totalAdaNeeded = makerFlatFeeAda + orderDepositAda + 0.35;
      return userOfferedBalance >= totalTokenNeeded && userAdaBalance >= totalAdaNeeded;
    }
  }, [
    wallet.connected,
    offeredToken.unit,
    depositAmountNum,
    makerFlatFeeAda,
    makerPercentFee,
    orderDepositAda,
    userAdaBalance,
    userOfferedBalance,
  ]);

  const handleDepositPercentage = (pct: number) => {
    clearError();
    if (offeredToken.unit === "lovelace") {
      // Save reserve for fees & order deposit
      const spendableAda = Math.max(0, userAdaBalance - (makerFlatFeeAda + orderDepositAda + 0.5));
      const target = (spendableAda * pct) / 100;
      setDepositAmountStr(target > 0 ? target.toFixed(2) : "0");
    } else {
      // Token: deduct 0.3% maker fee from maximum
      const maxTokens = userOfferedBalance / 1.003;
      const target = (maxTokens * pct) / 100;
      setDepositAmountStr(target > 0 ? target.toFixed(2) : "0");
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
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
    if (depositAmountNum <= 0 || calculatedReceiveAmount <= 0) return;

    try {
      const txHash = await placeOrder({
        offerAsset: depositAsset,
        offerAmount: depositAmountNum,
        askAmount: calculatedReceiveAmount,
      });
      setSubmittedTx(txHash);
      setDepositAmountStr("");
    } catch (err) {
      console.error(err);
    }
  };

  // --- FILL ORDER CALCULATIONS ---
  const fillDetails = useMemo(() => {
    if (!selectedOrder) return null;

    // Maker's order type:
    // If "ask": Maker offers Token A, asks Token B.
    // If "bid": Maker offers Token B, asks Token A.
    const makerOffersBase = selectedOrder.orderType === "ask";
    const makerOfferedToken = makerOffersBase ? tokenA : tokenB;
    const makerAskedToken = makerOffersBase ? tokenB : tokenA;

    const offeredDecimals = makerOfferedToken.decimals;
    const askedDecimals = makerAskedToken.decimals;

    const maxOfferedTokens = Number(formatTokenUnits(selectedOrder.offeredAmount, offeredDecimals));
    const userEnteredRaw = parseTokenUnits(fillAmountStr, offeredDecimals);
    let fillAmountRaw: bigint;
    if (userEnteredRaw >= selectedOrder.offeredAmount || !fillAmountStr) {
      fillAmountRaw = selectedOrder.offeredAmount;
    } else {
      fillAmountRaw = userEnteredRaw;
    }

    const cost = calculateFillCost(selectedOrder, fillAmountRaw);
    const payFormatted = Number(cost.payAmount) / Math.pow(10, askedDecimals);
    const receiveFormatted = Number(cost.receiveAmount) / Math.pow(10, offeredDecimals);

    // Calculate rates in both directions for this order
    const orderPriceNum = selectedOrder.effectivePrice;
    const orderPriceReciprocal = orderPriceNum > 0 ? 1 / orderPriceNum : 0;

    // Balance verification for taker:
    // Taker pays: cost.payAmount in makerAskedToken + 1.0 ADA taker fee + ~0.35 ADA network fee
    let hasSufficientBalance = false;
    if (makerAskedToken.unit === "lovelace") {
      const reqLovelace = cost.payAmount + cost.takerFeeLovelace + 350_000n;
      hasSufficientBalance = wallet.balanceLovelace >= reqLovelace;
    } else {
      const userTokenRaw =
        makerAskedToken.unit === "lovelace"
          ? wallet.balanceLovelace
          : wallet.tokenBalances[makerAskedToken.unit] || 0n;
      const reqLovelace = cost.takerFeeLovelace + 350_000n;
      hasSufficientBalance =
        userTokenRaw >= cost.payAmount && wallet.balanceLovelace >= reqLovelace;
    }

    return {
      makerOffersBase,
      makerOfferedToken,
      makerAskedToken,
      maxOfferedTokens,
      fillAmountRaw,
      cost,
      payFormatted,
      receiveFormatted,
      orderPriceNum,
      orderPriceReciprocal,
      isComplete: cost.isComplete,
      hasSufficientBalance,
    };
  }, [selectedOrder, fillAmountStr, tokenA, tokenB, wallet]);

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
      {/* Top Tabs: Create Order vs Fill Order */}
      <div className="flex items-center gap-1.5 p-1 bg-[#0b0e14] rounded-xl mb-4 border border-[#1f2d44]/50">
        <button
          type="button"
          onClick={() => {
            setPanelTab("create");
            clearError();
          }}
          className={`flex-1 py-2 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
            panelTab === "create"
              ? "bg-[#1f2d44] text-white shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <Coins className="w-3.5 h-3.5 text-emerald-400" />
          <span>Create New Order</span>
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
          <span>Fill Existing Order</span>
          {selectedOrder && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: CREATE NEW ORDER (Fully Symmetric: Offer X, Want Y)                */}
      {/* ========================================================================= */}
      {panelTab === "create" && (
        <form onSubmit={handleCreateSubmit} className="space-y-4 flex-1 flex flex-col">
          {/* Direction Card */}
          <div className="p-3 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-semibold uppercase tracking-wider text-[10px] text-slate-500">
                Order Direction
              </span>
              <button
                type="button"
                onClick={() => {
                  setDepositAsset((prev) => (prev === "base" ? "quote" : "base"));
                  clearError();
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#182234] hover:bg-[#1f2d44] text-slate-300 hover:text-white transition-colors"
                title="Swap Direction"
              >
                <ArrowDownUp className="w-3 h-3 text-emerald-400" />
                <span>Swap Tokens</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDepositAsset("base")}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  depositAsset === "base"
                    ? "bg-emerald-950/30 border-emerald-500/60 shadow-sm"
                    : "bg-[#141b27] border-[#1f2d44] hover:border-slate-600 opacity-60 hover:opacity-100"
                }`}
              >
                <div className="text-[10px] text-slate-400">Put in:</div>
                <div className="text-xs font-bold text-emerald-400">
                  {tokenA.symbol}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">Get back:</div>
                <div className="text-xs font-bold text-slate-200">
                  {tokenB.symbol}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDepositAsset("quote")}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  depositAsset === "quote"
                    ? "bg-emerald-950/30 border-emerald-500/60 shadow-sm"
                    : "bg-[#141b27] border-[#1f2d44] hover:border-slate-600 opacity-60 hover:opacity-100"
                }`}
              >
                <div className="text-[10px] text-slate-400">Put in:</div>
                <div className="text-xs font-bold text-emerald-400">
                  {tokenB.symbol}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">Get back:</div>
                <div className="text-xs font-bold text-slate-200">
                  {tokenA.symbol}
                </div>
              </button>
            </div>
          </div>

          {/* Input 1: You Put In / Deposit */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <label className="font-semibold flex items-center gap-1.5">
                <span className="text-emerald-400">1. You Put In</span>
                <span className="text-slate-500">({offeredToken.symbol})</span>
              </label>
              <span className="text-[11px] text-slate-400">
                Wallet: <strong className="text-white font-mono">{userOfferedBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
              </span>
            </div>

            <div className="relative">
              <input
                type="number"
                step="any"
                min="0"
                value={depositAmountStr}
                onChange={(e) => setDepositAmountStr(e.target.value)}
                placeholder="0.00"
                required
                className="w-full px-4 py-2.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] text-white text-sm font-mono focus:outline-none focus:border-emerald-500 transition-colors"
              />
              <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400 pointer-events-none">
                {offeredToken.symbol}
              </span>
            </div>

            {/* Percentage Shortcuts */}
            <div className="grid grid-cols-4 gap-2 pt-0.5">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => handleDepositPercentage(pct)}
                  className="py-1 rounded-lg bg-[#182234] border border-[#1f2d44] hover:border-slate-600 text-[11px] font-semibold text-slate-300 transition-colors"
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Input 2: Exchange Rate (with Dual Direction Display) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <label className="font-semibold flex items-center gap-1.5">
                <span>2. Exchange Rate</span>
              </label>
              <button
                type="button"
                onClick={() => setRateIsFlipped((prev) => !prev)}
                className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
                title="Flip rate input denomination"
              >
                <ArrowDownUp className="w-2.5 h-2.5" />
                <span>Quote as {rateIsFlipped ? `${tokenB.symbol} / ${tokenA.symbol}` : `${tokenA.symbol} / ${tokenB.symbol}`}</span>
              </button>
            </div>

            <div className="relative">
              <input
                type="number"
                step="any"
                min="0"
                value={rateStr}
                onChange={(e) => setRateStr(e.target.value)}
                placeholder="0.00"
                required
                className="w-full px-4 py-2.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] text-white text-sm font-mono focus:outline-none focus:border-emerald-500 transition-colors"
              />
              <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono pointer-events-none">
                {rateIsFlipped
                  ? `${tokenA.symbol} per 1 ${tokenB.symbol}`
                  : `${tokenB.symbol} per 1 ${tokenA.symbol}`}
              </span>
            </div>

            {/* DUAL RATE PILL: Always shows both directions */}
            <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] text-[11px] font-mono space-y-1">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-sans font-bold">
                Exchange Rate in Both Directions:
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span>1 {tokenA.symbol} =</span>
                <span className="font-semibold text-white">
                  {priceBperA > 0 ? (priceBperA < 0.0001 ? priceBperA.toExponential(4) : priceBperA.toFixed(4)) : "—"}{" "}
                  {tokenB.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-400 border-t border-[#1f2d44]/50 pt-1">
                <span>1 {tokenB.symbol} =</span>
                <span className="font-semibold text-slate-300">
                  {priceAperB > 0 ? (priceAperB < 0.0001 ? priceAperB.toExponential(4) : priceAperB.toFixed(4)) : "—"}{" "}
                  {tokenA.symbol}
                </span>
              </div>
            </div>

            {/* MINSWAP MARKET COMPARISON */}
            {minswapPrice && minswapPrice.available && (
              <div className="p-2.5 rounded-xl bg-blue-950/20 border border-blue-500/30 text-[11px] font-mono space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-blue-400 font-bold text-[10px] uppercase tracking-wider font-sans">
                    <ExternalLink className="w-3 h-3" />
                    <span>Minswap Market Price</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const targetRate = rateIsFlipped
                        ? minswapPrice.priceQuoteInBase
                        : minswapPrice.priceBaseInQuote;
                      setRateStr(targetRate.toString());
                    }}
                    className="text-[10px] text-blue-400 hover:text-blue-300 underline font-sans font-semibold transition-colors"
                  >
                    Use Minswap Rate
                  </button>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>1 {tokenA.symbol} =</span>
                  <span className="font-semibold text-white">
                    {formatMinswapRate(minswapPrice.priceBaseInQuote)} {tokenB.symbol}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-400 border-t border-blue-500/20 pt-1">
                  <span>1 {tokenB.symbol} =</span>
                  <span className="font-semibold text-slate-300">
                    {formatMinswapRate(minswapPrice.priceQuoteInBase)} {tokenA.symbol}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Output 3: You Get Out (Calculated) */}
          <div className="p-3.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-sans font-semibold text-emerald-400">3. You Get Back:</span>
              <span className="font-bold text-white text-sm">
                {calculatedReceiveAmount > 0
                  ? calculatedReceiveAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })
                  : "0.00"}{" "}
                {askedToken.symbol}
              </span>
            </div>

            <div className="border-t border-[#1f2d44] pt-2 space-y-1 text-[11px] text-slate-400">
              <div className="flex items-center justify-between">
                <span>Maker Flat Fee:</span>
                <span>{makerFlatFeeAda.toFixed(2)} ADA</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Maker Ratio (0.3%):</span>
                <span>
                  {makerPercentFee.toFixed(4)} {offeredToken.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1">
                  Order Deposit:
                  <span title="Locked in order UTxO, 100% refunded upon fill or cancel" className="text-slate-500 cursor-help">ⓘ</span>
                </span>
                <span>~{orderDepositAda.toFixed(2)} ADA (refundable)</span>
              </div>
            </div>
          </div>

          {!hasSufficientDepositBalance && (
            <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-600/40 text-amber-200 text-xs">
              ⚠️ Insufficient balance to cover deposit and protocol fees (~3.45 ADA + deposit).
            </div>
          )}

          {/* Success Message */}
          {submittedTx && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              <div className="space-y-1 overflow-hidden">
                <div className="font-bold">Order Placed On-Chain!</div>
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
                Connect Wallet to Place Order
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  actionPending ||
                  depositAmountNum <= 0 ||
                  calculatedReceiveAmount <= 0 ||
                  !hasSufficientDepositBalance
                }
                className="w-full py-3 rounded-xl font-bold text-sm transition-all shadow-lg flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-emerald-500/20 disabled:bg-emerald-500/40 disabled:cursor-not-allowed"
              >
                {actionPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{actionMessage || "Submitting Order..."}</span>
                  </>
                ) : (
                  <span>
                    Deposit {depositAmountNum > 0 ? depositAmountNum : ""} {offeredToken.symbol} & Place Order
                  </span>
                )}
              </button>
            )}
          </div>
        </form>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: FILL EXISTING ORDER (Crystal Clear: What You GET vs What You PAY)  */}
      {/* ========================================================================= */}
      {panelTab === "fill" && (
        <div className="flex-1 flex flex-col">
          {!selectedOrder ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-[#1f2d44] rounded-xl text-slate-400 space-y-3 my-auto">
              <Zap className="w-8 h-8 text-amber-400/80 animate-bounce" />
              <div className="space-y-1">
                <div className="text-sm font-semibold text-white">No Order Selected</div>
                <div className="text-xs text-slate-400 max-w-[230px]">
                  Click on any order in the Order Book to fill it partially or completely!
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPanelTab("create")}
                className="px-3 py-1.5 rounded-lg bg-[#182234] hover:bg-[#1f2d44] text-xs font-semibold text-slate-300 transition-colors"
              >
                Or Create a New Order
              </button>
            </div>
          ) : (
            fillDetails && (
              <form onSubmit={handleFillSubmit} className="space-y-4 flex-1 flex flex-col">
                {/* Active Selected Order Header */}
                <div className="p-3 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    {selectedOrder.isVault ? (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold uppercase tracking-wider">
                        <span>Smart Liquidity Vault</span>
                        {selectedOrder.isDynamicOracle && (
                          <span className="text-[9px] text-cyan-400 font-normal">
                            ({selectedOrder.vaultDirection === "reverse" ? "Reverse • Oracle" : "Straight • Oracle"})
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[11px]">Selected On-Chain Order:</span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onClearSelectedOrder?.();
                        setPanelTab("create");
                      }}
                      className="p-1 rounded hover:bg-[#1f2d44] text-slate-400 hover:text-white transition-colors"
                      title="Deselect Order"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Dual Rates of this order */}
                  <div className="p-2 rounded-lg bg-[#141b27] border border-[#1f2d44]/50 text-[11px] font-mono space-y-0.5">
                    <div className="flex items-center justify-between text-slate-300">
                      <span>1 {tokenA.symbol} =</span>
                      <span className="font-semibold text-white">
                        {fillDetails.orderPriceNum < 0.0001
                          ? fillDetails.orderPriceNum.toExponential(4)
                          : fillDetails.orderPriceNum.toFixed(4)}{" "}
                        {tokenB.symbol}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400 border-t border-[#1f2d44]/40 pt-0.5">
                      <span>1 {tokenB.symbol} =</span>
                      <span className="font-semibold text-slate-300">
                        {fillDetails.orderPriceReciprocal < 0.0001
                          ? fillDetails.orderPriceReciprocal.toExponential(4)
                          : fillDetails.orderPriceReciprocal.toFixed(4)}{" "}
                        {tokenA.symbol}
                      </span>
                    </div>
                  </div>

                  {/* Minswap Market Comparison */}
                  {minswapPrice && minswapPrice.available && (
                    <div className="p-2 rounded-lg bg-blue-950/20 border border-blue-500/30 text-[10px] font-mono space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-blue-400 font-sans font-bold flex items-center gap-1 uppercase tracking-wider text-[9px]">
                          <ExternalLink className="w-2.5 h-2.5" />
                          <span>Minswap Market</span>
                        </span>
                        {(() => {
                          if (minswapPrice.priceBaseInQuote <= 0) return null;
                          const diff =
                            ((fillDetails.orderPriceNum - minswapPrice.priceBaseInQuote) /
                              minswapPrice.priceBaseInQuote) *
                            100;
                          return (
                            <span
                              className={`px-1 py-0.2 rounded font-sans font-bold ${
                                Math.abs(diff) < 0.5
                                  ? "bg-slate-800 text-slate-300"
                                  : diff > 0
                                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              }`}
                            >
                              {diff > 0 ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`} vs Minswap
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex items-center justify-between text-slate-300">
                        <span>1 {tokenA.symbol} =</span>
                        <span className="font-semibold text-white">
                          {formatMinswapRate(minswapPrice.priceBaseInQuote)} {tokenB.symbol}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400 border-t border-blue-500/20 pt-0.5">
                        <span>1 {tokenB.symbol} =</span>
                        <span className="font-semibold text-slate-300">
                          {formatMinswapRate(minswapPrice.priceQuoteInBase)} {tokenA.symbol}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 1. YOU GET (Prominent Emerald Card) */}
                <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/40 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                      <span>1. YOU GET (Deposited to wallet)</span>
                    </span>
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
                      className="w-full px-4 py-2.5 rounded-xl bg-[#0b0e14] border border-emerald-500/50 text-white text-sm font-mono focus:outline-none focus:border-emerald-400 transition-colors"
                    />
                    <span className="absolute right-3 top-2.5 text-xs font-bold text-emerald-400 pointer-events-none">
                      {fillDetails.makerOfferedToken.symbol}
                    </span>
                  </div>

                  {/* Percentage shortcuts */}
                  <div className="grid grid-cols-4 gap-2">
                    {[25, 50, 75, 100].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => handleFillPercentage(pct)}
                        className={`py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                          pct === 100
                            ? "bg-emerald-900/40 border-emerald-500/60 text-emerald-200"
                            : "bg-[#182234] border-[#1f2d44] text-slate-300 hover:border-slate-500"
                        }`}
                      >
                        {pct === 100 ? "100% (All)" : `${pct}%`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. YOU PAY (Prominent Contrast Card) */}
                <div className="p-3.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-2 text-xs font-mono">
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="font-sans font-bold text-rose-400">2. YOU PAY (From wallet):</span>
                    <span className="font-bold text-white text-sm">
                      {fillDetails.payFormatted.toFixed(4)} {fillDetails.makerAskedToken.symbol}
                    </span>
                  </div>

                  <div className="border-t border-[#1f2d44] pt-2 space-y-1 text-[11px] text-slate-400">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        Protocol Taker Fee:
                        <span
                          title={
                            selectedOrder.isVault
                              ? "Smart Liquidity Vault taker fee: 0.90 ADA flat fee (+ 0.3% maker/taker proportional protocol fee)"
                              : "Fixed Genius Yield taker fee: 1.00 ADA"
                          }
                          className="text-slate-500 cursor-help"
                        >
                          ⓘ
                        </span>
                      </span>
                      <span>{(Number(fillDetails.cost.takerFeeLovelace) / 1_000_000).toFixed(2)} ADA</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span>Fill Execution:</span>
                      <span className={fillDetails.isComplete ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}>
                        {fillDetails.isComplete ? "Complete Fill (Closes order)" : "Partial Fill (Leaves remaining)"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Wallet Balance Status */}
                <div className="text-[11px] flex items-center justify-between text-slate-400 px-1">
                  <span>Your Wallet Balance:</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    {fillDetails.makerAskedToken.symbol === "ADA"
                      ? `${userAdaBalance.toFixed(2)} ADA`
                      : `${(fillDetails.makerAskedToken === tokenA ? userTokenABalance : userTokenBBalance).toFixed(2)} ${fillDetails.makerAskedToken.symbol}`}
                  </span>
                </div>

                {!fillDetails.hasSufficientBalance && (
                  <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-600/40 text-amber-200 text-xs">
                    ⚠️ Insufficient balance to cover payment and 1.0 ADA taker protocol fee.
                  </div>
                )}

                {/* Success Message */}
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
                          Pay {fillDetails.payFormatted.toFixed(2)} {fillDetails.makerAskedToken.symbol} to Get {fillDetails.receiveFormatted.toFixed(2)} {fillDetails.makerOfferedToken.symbol}
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
    </div>
  );
};
