import React, { useState, useEffect } from "react";
import {
  X,
  ArrowRightLeft,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Info,
  CheckCircle2,
  TrendingUp,
  Sparkles,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { LiquidityVault } from "../types";
import { fillLiquidityVault } from "../contracts/slv";
import { SignedOracleCertificate } from "../services/oracle";
import { formatNumericPrice, getVaultAdaReserve } from "../services/liquidity";

interface TradeVaultModalProps {
  vault: LiquidityVault | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (txHash: string) => void;
}

export const TradeVaultModal: React.FC<TradeVaultModalProps> = ({
  vault,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { wallet, settings, lucid } = useApp();

  const [direction, setDirection] = useState<"straight" | "reverse">("straight");
  const [fillAmountInput, setFillAmountInput] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Oracle Certificate State
  const [oracleCert, setOracleCert] = useState<SignedOracleCertificate | null>(null);
  const [oracleLoading, setOracleLoading] = useState<boolean>(false);
  const [oracleError, setOracleError] = useState<string | null>(null);

  // Reset state when opening a new vault
  useEffect(() => {
    if (isOpen && vault) {
      setDirection("straight");
      setFillAmountInput("");
      setTxHash(null);
      setErrorMsg(null);
      setOracleCert(null);
      setOracleError(null);

      if (vault.pricingType === "delta_oracle" || vault.pricingType === "oracle_range") {
        fetchOracleCert("straight");
      }
    }
  }, [isOpen, vault]);

  const fetchOracleCert = async (targetDirection: "straight" | "reverse" = direction) => {
    if (!vault) return;
    setOracleLoading(true);
    setOracleError(null);
    try {
      const isRev = targetDirection === "reverse";
      const baseTok = isRev ? vault.tokenB : vault.tokenA;
      const quoteTok = isRev ? vault.tokenA : vault.tokenB;

      const res = await fetch("https://2.28.204.8.sslip.io/api/v1/oracle/certificate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network: settings.network.toLowerCase(),
          baseAsset: {
            policyHex: baseTok.policyId || "",
            tokenHex: baseTok.assetName || "",
            symbol: baseTok.symbol || "",
          },
          quoteAsset: {
            policyHex: quoteTok.policyId || "",
            tokenHex: quoteTok.assetName || "",
            symbol: quoteTok.symbol || "",
          },
          symbol: baseTok.symbol !== "ADA" && baseTok.symbol !== "tADA" ? baseTok.symbol : quoteTok.symbol,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.approved) {
        throw new Error(data.rejectionReason || data.error || "Oracle rejected certificate generation.");
      }

      setOracleCert({
        network: data.network,
        baseAsset: data.baseAsset,
        quoteAsset: data.quoteAsset,
        price: {
          numerator: BigInt(data.price.numerator),
          denominator: BigInt(data.price.denominator),
          approximateRate: data.price.approximateRate,
        },
        timestampMs: BigInt(data.timestampMs),
        signatureHex: data.signatureHex,
        oraclePubKeyHex: data.oraclePubKeyHex,
        cborHex: data.cborHex || "",
        quotes: data.quotes,
        divergencePercent: data.divergencePercent,
      });
    } catch (err: any) {
      console.error("Failed to fetch oracle certificate:", err);
      setOracleError(err.message || "Failed to reach Oracle service.");
    } finally {
      setOracleLoading(false);
    }
  };

  if (!isOpen || !vault) return null;

  const isStraight = direction === "straight";
  const tokenA = vault.tokenA;
  const tokenB = vault.tokenB;

  // Max available in chosen leg:
  const maxAvailable = isStraight
    ? Number(vault.amountA) / 10 ** tokenA.decimals
    : Number(vault.amountB) / 10 ** tokenB.decimals;

  // Has reverse leg?
  const hasReverse =
    vault.pricingType === "fixed"
      ? !!vault.fixedPrice?.hasReverse
      : !!vault.oracleDelta?.hasReverse;

  const parsedFillAmount = parseFloat(fillAmountInput);
  const isValidAmount =
    !isNaN(parsedFillAmount) && parsedFillAmount > 0 && parsedFillAmount <= maxAvailable;

  // Compute fillAmount in BigInt atomic units
  const fillAmountAtomic = isValidAmount
    ? BigInt(Math.floor(parsedFillAmount * 10 ** (isStraight ? tokenA.decimals : tokenB.decimals)))
    : 0n;

  // Calculate estimated price & payment
  let rateDisplay = "";
  let paymentDisplay = "";
  let estPaymentAmount = 0;

  if (vault.pricingType === "fixed" && vault.fixedPrice) {
    if (isStraight) {
      rateDisplay = `${formatNumericPrice(vault.fixedPrice.priceAtoB)} ${tokenB.symbol} per ${tokenA.symbol}`;
      estPaymentAmount = (parsedFillAmount || 0) * vault.fixedPrice.priceAtoB;
    } else {
      const revRate = vault.fixedPrice.reversePriceBtoA ?? 1 / (vault.fixedPrice.priceAtoB || 1);
      rateDisplay = `${formatNumericPrice(revRate)} ${tokenA.symbol} per ${tokenB.symbol}`;
      estPaymentAmount = (parsedFillAmount || 0) * revRate;
    }
  } else if (oracleCert) {
    const baseRate = oracleCert.price.approximateRate;
    const spreadPct = isStraight
      ? (vault.oracleDelta?.straightSpreadPercent ?? 0)
      : (vault.oracleDelta?.reverseSpreadPercent ?? 0);
    const effRate = baseRate * (1 + spreadPct / 100);
    const paySymbol = isStraight ? tokenB.symbol : tokenA.symbol;
    const buySymbol = isStraight ? tokenA.symbol : tokenB.symbol;
    rateDisplay = `${formatNumericPrice(effRate)} ${paySymbol} per ${buySymbol}`;
    estPaymentAmount = (parsedFillAmount || 0) * effRate;
  }

  if (estPaymentAmount > 0) {
    paymentDisplay = `${formatNumericPrice(estPaymentAmount)} ${isStraight ? tokenB.symbol : tokenA.symbol}`;
  }

  const handleTrade = async () => {
    if (!lucid || !isValidAmount || fillAmountAtomic <= 0n) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    setTxHash(null);

    try {
      const hash = await fillLiquidityVault(lucid, {
        vault,
        fillAmount: fillAmountAtomic,
        direction,
        oracleCertificate: oracleCert || undefined,
        recipientAddress: wallet.address || undefined,
      });

      setTxHash(hash);
      onSuccess(hash);
    } catch (err: any) {
      console.error("Trade failed:", err);
      setErrorMsg(err.message || "Failed to submit trade transaction to Cardano.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#121824] border border-[#1f2d44] rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2d44]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-white">Trade Smart Liquidity Vault</h2>
              <p className="text-xs text-slate-400">
                Peer-to-peer on-chain partial fill via Plutus contracts
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#182234] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 overflow-y-auto max-h-[80vh]">
          {/* Pair & Available Reserves */}
          <div className="p-4 rounded-2xl bg-[#0b0e14] border border-[#1f2d44] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">Vault Pair</span>
              <span className="text-sm font-bold text-white">
                {tokenA.symbol} / {tokenB.symbol}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1a2333]">
              <div className="bg-[#121824] p-2.5 rounded-xl border border-[#1f2d44]">
                <div className="text-[11px] text-slate-400">Available {tokenA.symbol}</div>
                <div className="text-sm font-mono font-bold text-emerald-400">
                  {vault.formattedAmountA}
                </div>
              </div>
              <div className="bg-[#121824] p-2.5 rounded-xl border border-[#1f2d44]">
                <div className="text-[11px] text-slate-400">Available {tokenB.symbol}</div>
                <div className="text-sm font-mono font-bold text-sky-400">
                  {vault.formattedAmountB}
                </div>
              </div>
            </div>
          </div>

          {/* Direction Selector (if Two-Way) */}
          {hasReverse ? (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Trading Direction</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDirection("straight");
                    setFillAmountInput("");
                    if (vault.pricingType === "delta_oracle" || vault.pricingType === "oracle_range") {
                      fetchOracleCert("straight");
                    }
                  }}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                    isStraight
                      ? "bg-sky-500/20 border-sky-500 text-sky-200 shadow-sm"
                      : "bg-[#0b0e14] border-[#1f2d44] text-slate-400 hover:text-white"
                  }`}
                >
                  Buy {tokenA.symbol} (with {tokenB.symbol})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDirection("reverse");
                    setFillAmountInput("");
                    if (vault.pricingType === "delta_oracle" || vault.pricingType === "oracle_range") {
                      fetchOracleCert("reverse");
                    }
                  }}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                    !isStraight
                      ? "bg-sky-500/20 border-sky-500 text-sky-200 shadow-sm"
                      : "bg-[#0b0e14] border-[#1f2d44] text-slate-400 hover:text-white"
                  }`}
                >
                  Buy {tokenB.symbol} (with {tokenA.symbol})
                </button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400 bg-[#0b0e14] p-2.5 rounded-xl border border-[#1f2d44]">
              <span className="font-semibold text-slate-300">Direction:</span> Buy {tokenA.symbol} with {tokenB.symbol} (one-way vault)
            </div>
          )}

          {/* Oracle Status Box (if dynamic) */}
          {(vault.pricingType === "delta_oracle" || vault.pricingType === "oracle_range") && (
            <div className="p-3.5 rounded-2xl bg-[#0b0e14] border border-[#1f2d44] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Dual-Source Oracle Status
                </span>
                {oracleLoading && (
                  <span className="flex items-center gap-1 text-slate-400 text-[11px]">
                    <Loader2 className="w-3 h-3 animate-spin text-sky-400" />
                    Fetching live cert...
                  </span>
                )}
                {oracleCert && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Approved ({oracleCert.divergencePercent?.toFixed(2)}% div)
                  </span>
                )}
              </div>

              {oracleCert && (
                <div className="text-[11px] text-slate-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Sources:</span>
                    <span className="text-slate-200 font-mono">
                      {oracleCert.quotes?.map((q) => q.provider).join(", ") || "Minswap, DexScreener"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Oracle Key:</span>
                    <span className="text-slate-200 font-mono text-[10px]">
                      {oracleCert.oraclePubKeyHex.slice(0, 10)}...{oracleCert.oraclePubKeyHex.slice(-6)}
                    </span>
                  </div>
                </div>
              )}

              {oracleError && (
                <div className="flex items-center gap-2 p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{oracleError}</span>
                </div>
              )}
            </div>
          )}

          {/* Rate Display */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#0b0e14] border border-[#1f2d44]">
            <span className="text-xs text-slate-400 font-medium">Execution Price:</span>
            <span className="text-xs font-bold text-sky-300 font-mono">
              {rateDisplay || "Resolving rate..."}
            </span>
          </div>

          {/* Amount Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-slate-300">
                Amount to Buy ({isStraight ? tokenA.symbol : tokenB.symbol})
              </label>
              <button
                type="button"
                onClick={() => setFillAmountInput(maxAvailable.toString())}
                className="text-sky-400 hover:text-sky-300 font-semibold text-[11px]"
              >
                Max: {maxAvailable} {isStraight ? tokenA.symbol : tokenB.symbol}
              </button>
            </div>
            <div className="relative">
              <input
                type="number"
                step="any"
                min="0"
                max={maxAvailable}
                value={fillAmountInput}
                onChange={(e) => setFillAmountInput(e.target.value)}
                placeholder={`0.0 ${isStraight ? tokenA.symbol : tokenB.symbol}`}
                className="w-full bg-[#0b0e14] border border-[#1f2d44] focus:border-sky-500 rounded-2xl px-4 py-3 text-sm text-white font-mono placeholder:text-slate-600 outline-none transition-all"
              />
            </div>
          </div>

          {/* Estimated Payout & Protocol Fees */}
          {paymentDisplay && (
            <div className="p-3.5 rounded-2xl bg-[#0b0e14] border border-[#1f2d44] space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-300 font-semibold">
                <span>You Provide:</span>
                <span className="font-mono text-emerald-400">{paymentDisplay}</span>
              </div>
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>Taker Flat Fee:</span>
                <span className="font-mono">0.9 ADA</span>
              </div>
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>Maker & Taker Ratios:</span>
                <span className="font-mono">0.3% / 0.3%</span>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="flex items-center gap-2 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Success Message */}
          {txHash && (
            <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>Trade Submitted Successfully!</span>
              </div>
              <div className="font-mono text-[11px] break-all text-slate-300">
                Tx: {txHash}
              </div>
              <a
                href={`https://${settings.network === "preprod" ? "preprod." : ""}cardanoscan.io/transaction/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 underline font-semibold text-xs"
              >
                <span>View on Cardanoscan</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {/* Submit Button */}
          {!txHash && (
            <button
              type="button"
              onClick={handleTrade}
              disabled={isSubmitting || !isValidAmount || (vault.pricingType !== "fixed" && !oracleCert)}
              className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-sm shadow-lg shadow-sky-500/20 disabled:opacity-40 disabled:pointer-events-none transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Building & Signing Transaction...</span>
                </>
              ) : (
                <>
                  <ArrowRightLeft className="w-4 h-4" />
                  <span>Execute Trade ({isStraight ? `Buy ${tokenA.symbol}` : `Buy ${tokenB.symbol}`})</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
