import React, { useState, useEffect } from "react";
import { ArrowUpDown, Info, Loader2, CheckCircle2, ExternalLink } from "lucide-react";
import { useApp } from "../context/AppContext";

interface TradePanelProps {
  initialPrice?: number;
  initialAmount?: number;
  onOpenWallet: () => void;
  onOpenSettings: () => void;
}

export const TradePanel: React.FC<TradePanelProps> = ({
  initialPrice,
  initialAmount,
  onOpenWallet,
  onOpenSettings,
}) => {
  const {
    activePair,
    wallet,
    settings,
    placeOrder,
    actionPending,
    actionMessage,
    error,
    clearError,
  } = useApp();

  const [orderType, setOrderType] = useState<"buy" | "sell">("buy");
  const [priceStr, setPriceStr] = useState<string>("");
  const [amountStr, setAmountStr] = useState<string>("");
  const [submittedTx, setSubmittedTx] = useState<string | null>(null);

  // Sync initial price from orderbook click
  useEffect(() => {
    if (initialPrice !== undefined && initialPrice > 0) {
      setPriceStr(initialPrice.toString());
    }
  }, [initialPrice]);

  useEffect(() => {
    if (initialAmount !== undefined && initialAmount > 0) {
      setAmountStr(initialAmount.toString());
    }
  }, [initialAmount]);

  const priceNum = parseFloat(priceStr) || 0;
  const amountNum = parseFloat(amountStr) || 0;
  const totalQuote = priceNum * amountNum;

  // Compute fees
  const makerFlatFeeAda = 1.0;
  const makerPercentFee = orderType === "sell" ? amountNum * 0.003 : totalQuote * 0.003;
  const orderDepositAda = 2.1;

  // Available user balance
  const userAdaBalance = Number(wallet.balanceLovelace) / 1_000_000;
  const userBaseTokenBalance =
    activePair.baseToken.unit === "lovelace"
      ? userAdaBalance
      : Number(wallet.tokenBalances[activePair.baseToken.unit] || 0n) /
        Math.pow(10, activePair.baseToken.decimals);

  const handlePercentage = (pct: number) => {
    clearError();
    if (orderType === "buy") {
      // In a buy, user spends ADA
      // Account for rough tx fee and deposit
      const spendableAda = Math.max(0, userAdaBalance - 3.5);
      const targetAda = spendableAda * (pct / 100);
      if (priceNum > 0) {
        setAmountStr((targetAda / priceNum).toFixed(2));
      }
    } else {
      // In a sell, user spends base token
      const targetTokens = userBaseTokenBalance * (pct / 100);
      setAmountStr(targetTokens.toFixed(2));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
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

    if (amountNum <= 0 || priceNum <= 0) {
      return;
    }

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

  const explorerBaseUrl =
    settings.network === "mainnet"
      ? "https://cardanoscan.io/transaction"
      : "https://preprod.cardanoscan.io/transaction";

  return (
    <div className="bg-[#121824] border border-[#1f2d44] rounded-2xl overflow-hidden shadow-xl p-5 flex flex-col h-full">
      {/* Buy / Sell Tabs */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-[#0b0e14] rounded-xl mb-5">
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

      <form onSubmit={handleSubmit} className="space-y-4 flex-1 flex flex-col">
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
              onClick={() => handlePercentage(pct)}
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
  );
};
