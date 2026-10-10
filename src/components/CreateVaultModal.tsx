import React, { useState } from "react";
import {
  X,
  PlusCircle,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Info,
  CheckCircle2,
  Coins,
  Layers,
} from "lucide-react";
import { fromHex } from "@lucid-evolution/lucid";
import { useApp } from "../context/AppContext";
import { TokenInfo } from "../types";
import { createLiquidityVault } from "../contracts/slv";
import { toExactRational, fetchLiveOraclePrice } from "../services/oracle";
import { formatNumericPrice } from "../services/liquidity";

interface CreateVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (txHash: string) => void;
}

export const CreateVaultModal: React.FC<CreateVaultModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { wallet, settings, lucid } = useApp();

  // Asset A (Offered)
  const [selectedTokenAUnit, setSelectedTokenAUnit] = useState<string>("lovelace");
  const [amountAInput, setAmountAInput] = useState<string>("0");

  // Asset B (Asked)
  const [selectedTokenBUnit, setSelectedTokenBUnit] = useState<string>("lovelace");
  const [amountBInput, setAmountBInput] = useState<string>("0");

  // Pricing Mode: 'fixed' | 'oracle'
  const [pricingType, setPricingType] = useState<"fixed" | "oracle">("fixed");

  // Fixed Price fields
  const [fixedPriceInput, setFixedPriceInput] = useState<string>("1.0");
  const [enableReverseFixed, setEnableReverseFixed] = useState<boolean>(false);
  const [reversePriceInput, setReversePriceInput] = useState<string>("1.0");

  // Oracle fields
  const [spreadPercentInput, setSpreadPercentInput] = useState<string>("1.0");
  const [enableReverseOracle, setEnableReverseOracle] = useState<boolean>(false);
  const [reverseSpreadPercentInput, setReverseSpreadPercentInput] = useState<string>("1.0");

  // Live Oracle Reference Price
  const [liveOraclePrice, setLiveOraclePrice] = useState<number | null>(null);
  const [liveOracleLoading, setLiveOracleLoading] = useState<boolean>(false);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Available token options (ADA + customTokens + tokens in wallet)
  const adaToken: TokenInfo = {
    unit: "lovelace",
    policyId: "",
    name: "ADA",
    symbol: settings.network === "mainnet" ? "ADA" : "tADA",
    decimals: 6,
  };

  const availableTokens: TokenInfo[] = [
    adaToken,
    ...(settings.customTokens || []),
  ];

  // Helper to find token info
  const getTokenInfo = (unit: string): TokenInfo => {
    return (
      availableTokens.find((t) => t.unit === unit) || {
        unit,
        policyId: unit.slice(0, 56),
        name: unit.slice(56),
        symbol: unit.slice(56)
          ? (() => {
              try {
                return new TextDecoder().decode(fromHex(unit.slice(56)));
              } catch {
                return "TOKEN";
              }
            })()
          : "TOKEN",
        decimals: 0,
      }
    );
  };

  const tokenA = getTokenInfo(selectedTokenAUnit);
  const tokenB = getTokenInfo(selectedTokenBUnit);

  // Fetch live benchmark price for the selected pair
  React.useEffect(() => {
    if (!tokenA || !tokenB || tokenA.unit === tokenB.unit) {
      setLiveOraclePrice(null);
      return;
    }
    let isCancelled = false;
    setLiveOracleLoading(true);
    fetchLiveOraclePrice(settings.network, tokenA, tokenB)
      .then((price) => {
        if (!isCancelled) {
          setLiveOraclePrice(price);
          setLiveOracleLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setLiveOraclePrice(null);
          setLiveOracleLoading(false);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [tokenA.unit, tokenB.unit, settings.network]);

  // Validate inputs
  const parsedAmountA = parseFloat(amountAInput);
  const parsedAmountB = parseFloat(amountBInput || "0");
  const parsedFixedPrice = parseFloat(fixedPriceInput);
  const parsedReversePrice = parseFloat(reversePriceInput);
  const parsedSpread = parseFloat(spreadPercentInput);
  const parsedReverseSpread = parseFloat(reverseSpreadPercentInput);

  const isAmountAValid = !isNaN(parsedAmountA) && parsedAmountA > 0;
  const isAmountBValid = !isNaN(parsedAmountB) && parsedAmountB >= 0;
  const isFixedValid =
    pricingType !== "fixed" ||
    (!isNaN(parsedFixedPrice) &&
      parsedFixedPrice > 0 &&
      (!enableReverseFixed || (!isNaN(parsedReversePrice) && parsedReversePrice > 0)));
  const isOracleValid =
    pricingType !== "oracle" ||
    (!isNaN(parsedSpread) &&
      (!enableReverseOracle || !isNaN(parsedReverseSpread)));

  const isFormValid =
    isAmountAValid &&
    isAmountBValid &&
    isFixedValid &&
    isOracleValid &&
    selectedTokenAUnit !== selectedTokenBUnit;

  // Known official Oracle public keys
  const officialOraclePubKey =
    settings.network === "mainnet"
      ? "24207cde7ca2dc27431ff87b5324ab5b0d8c113f608f5143ff50a6bae60373c0"
      : "b953f42e6d44d217ed8ae94a20f3b448ca45757031dfdb2b879ae389cac68e29";

  const handleCreate = async () => {
    if (!lucid || !wallet.address || !isFormValid) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    setTxHash(null);

    try {
      const atomicAmountA = BigInt(
        Math.floor(parsedAmountA * 10 ** tokenA.decimals)
      );
      const atomicAmountB = BigInt(
        Math.floor(parsedAmountB * 10 ** tokenB.decimals)
      );

      let pricingPayload: any;

      if (pricingType === "fixed") {
        // Raw asset ratio: units of B per unit of A
        const rawRate =
          (parsedFixedPrice * 10 ** tokenB.decimals) / 10 ** tokenA.decimals;
        const straightRatio = toExactRational(rawRate);

        let reverseRatio: any = undefined;
        if (enableReverseFixed) {
          // Units of A per unit of B
          const rawRevRate =
            (parsedReversePrice * 10 ** tokenA.decimals) / 10 ** tokenB.decimals;
          reverseRatio = toExactRational(rawRevRate);
        }

        pricingPayload = {
          type: "fixed",
          price: straightRatio,
          reversePrice: reverseRatio,
        };
      } else {
        // Dynamic Oracle
        const spreadRatio = toExactRational(parsedSpread / 100);
        let revSpreadRatio: any = undefined;
        let revOffsetRatio: any = undefined;

        if (enableReverseOracle) {
          revSpreadRatio = toExactRational(parsedReverseSpread / 100);
          revOffsetRatio = { numerator: 0n, denominator: 1n };
        }

        pricingPayload = {
          type: "oracle",
          oraclePubKeyHex: officialOraclePubKey,
          offset: { numerator: 0n, denominator: 1n },
          spread: spreadRatio,
          reverseOffset: revOffsetRatio,
          reverseSpread: revSpreadRatio,
        };
      }

      const res = await createLiquidityVault(lucid, {
        ownerAddress: wallet.address,
        offeredAsset: {
          policyId: tokenA.policyId || "",
          assetName: tokenA.assetName || "",
          amount: atomicAmountA,
        },
        askedAsset: {
          policyId: tokenB.policyId || "",
          assetName: tokenB.assetName || "",
          amount: atomicAmountB,
        },
        pricing: pricingPayload,
      });

      setTxHash(res.txHash);
      onSuccess(res.txHash);
    } catch (err: any) {
      console.error("Vault creation failed:", err);
      setErrorMsg(err.message || "Failed to submit vault creation transaction.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#121824] border border-[#1f2d44] rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2d44]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-white">Create Smart Liquidity Vault</h2>
              <p className="text-xs text-slate-400">
                Deploy a sovereign, automated on-chain liquidity position
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

        {/* Form Body */}
        <div className="p-6 space-y-4 overflow-y-auto max-h-[80vh]">
          {/* Asset A (Offered) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              Offered Asset (Token A to Deposit)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={selectedTokenAUnit}
                onChange={(e) => setSelectedTokenAUnit(e.target.value)}
                className="bg-[#0b0e14] border border-[#1f2d44] text-white text-xs rounded-xl px-3 py-2.5 outline-none font-semibold"
              >
                {availableTokens.map((t) => (
                  <option key={t.unit} value={t.unit}>
                    {t.symbol} ({t.name})
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="any"
                min="0"
                value={amountAInput}
                onChange={(e) => setAmountAInput(e.target.value)}
                placeholder={`Amount of ${tokenA.symbol}`}
                className="bg-[#0b0e14] border border-[#1f2d44] focus:border-sky-500 rounded-xl px-3 py-2.5 text-xs text-white font-mono placeholder:text-slate-600 outline-none"
              />
            </div>
          </div>

          {/* Asset B (Asked / Reserve) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              Asked Asset (Token B to Receive / Initial Pool)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={selectedTokenBUnit}
                onChange={(e) => setSelectedTokenBUnit(e.target.value)}
                className="bg-[#0b0e14] border border-[#1f2d44] text-white text-xs rounded-xl px-3 py-2.5 outline-none font-semibold"
              >
                {availableTokens.map((t) => (
                  <option key={t.unit} value={t.unit}>
                    {t.symbol} ({t.name})
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="any"
                min="0"
                value={amountBInput}
                onChange={(e) => setAmountBInput(e.target.value)}
                placeholder={`Initial ${tokenB.symbol} (0 for one-way)`}
                className="bg-[#0b0e14] border border-[#1f2d44] focus:border-sky-500 rounded-xl px-3 py-2.5 text-xs text-white font-mono placeholder:text-slate-600 outline-none"
              />
            </div>
            <div className="text-[11px] text-slate-500">
              Set initial {tokenB.symbol} to 0 for a one-way sell vault, or deposit both to allow two-way trading immediately.
            </div>
          </div>

          {/* Pricing Model Tabs */}
          <div className="space-y-2 pt-2 border-t border-[#1a2333]">
            <label className="text-xs font-semibold text-slate-300">Pricing Strategy</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPricingType("fixed")}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                  pricingType === "fixed"
                    ? "bg-sky-500/20 border-sky-500 text-sky-200 shadow-sm"
                    : "bg-[#0b0e14] border-[#1f2d44] text-slate-400 hover:text-white"
                }`}
              >
                Fixed Price
              </button>
              <button
                type="button"
                onClick={() => setPricingType("oracle")}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                  pricingType === "oracle"
                    ? "bg-sky-500/20 border-sky-500 text-sky-200 shadow-sm"
                    : "bg-[#0b0e14] border-[#1f2d44] text-slate-400 hover:text-white"
                }`}
              >
                Dynamic Oracle (Market)
              </button>
            </div>
          </div>

          {/* Fixed Price Settings */}
          {pricingType === "fixed" && (
            <div className="p-3.5 rounded-2xl bg-[#0b0e14] border border-[#1f2d44] space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-400">
                    Straight Price ({tokenB.symbol} per {tokenA.symbol})
                  </label>
                  {liveOraclePrice && liveOraclePrice > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setFixedPriceInput(liveOraclePrice.toString());
                        if (enableReverseFixed) {
                          setReversePriceInput((1 / liveOraclePrice).toString());
                        }
                      }}
                      className="text-[10px] text-sky-400 hover:text-sky-300 font-semibold underline underline-offset-2"
                    >
                      Use Market Price ({formatNumericPrice(liveOraclePrice)})
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  step="any"
                  value={fixedPriceInput}
                  onChange={(e) => setFixedPriceInput(e.target.value)}
                  className="w-full bg-[#121824] border border-[#1f2d44] rounded-xl px-3 py-2 text-xs text-white font-mono outline-none"
                />
                {parsedFixedPrice > 0 && (
                  <div className="p-2 rounded-xl bg-[#121824] border border-[#1f2d44] text-[11px] space-y-0.5">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Straight:</span>
                      <span className="font-mono text-sky-400 font-semibold">
                        1 {tokenA.symbol} = {formatNumericPrice(parsedFixedPrice)} {tokenB.symbol}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Reciprocal:</span>
                      <span className="font-mono text-slate-400">
                        1 {tokenB.symbol} = {formatNumericPrice(1 / parsedFixedPrice)} {tokenA.symbol}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-2 border-t border-[#1a2333]">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={enableReverseFixed}
                    onChange={(e) => setEnableReverseFixed(e.target.checked)}
                    className="rounded border-[#1f2d44] text-sky-500 focus:ring-0 bg-[#121824]"
                  />
                  <span>Enable Reverse Trading Leg (Two-Way Order)</span>
                </label>

                {enableReverseFixed && (
                  <div className="space-y-1.5 pl-5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-slate-400">
                        Reverse Price ({tokenA.symbol} per {tokenB.symbol})
                      </label>
                      {parsedFixedPrice > 0 && (
                        <button
                          type="button"
                          onClick={() => setReversePriceInput((1 / parsedFixedPrice).toString())}
                          className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold underline underline-offset-2"
                        >
                          Reciprocal ({formatNumericPrice(1 / parsedFixedPrice)})
                        </button>
                      )}
                    </div>
                    <input
                      type="number"
                      step="any"
                      value={reversePriceInput}
                      onChange={(e) => setReversePriceInput(e.target.value)}
                      className="w-full bg-[#121824] border border-[#1f2d44] rounded-xl px-3 py-2 text-xs text-white font-mono outline-none"
                    />
                    {parsedReversePrice > 0 && (
                      <div className="p-2 rounded-xl bg-[#121824] border border-[#1f2d44] text-[11px] space-y-0.5">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Reverse:</span>
                          <span className="font-mono text-emerald-400 font-semibold">
                            1 {tokenB.symbol} = {formatNumericPrice(parsedReversePrice)} {tokenA.symbol}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Reciprocal:</span>
                          <span className="font-mono text-slate-400">
                            1 {tokenA.symbol} = {formatNumericPrice(1 / parsedReversePrice)} {tokenB.symbol}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Dynamic Oracle Settings */}
          {pricingType === "oracle" && (
            <div className="p-3.5 rounded-2xl bg-[#0b0e14] border border-[#1f2d44] space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Dual-Source Oracle Service</span>
                </div>
                {liveOraclePrice ? (
                  <div className="flex flex-col items-end font-mono text-[11px] space-y-0.5">
                    <span className="text-sky-400">
                      1 {tokenA.symbol} = {formatNumericPrice(liveOraclePrice)} {tokenB.symbol}
                    </span>
                    {liveOraclePrice > 0 && (
                      <span className="text-slate-400 text-[10px]">
                        1 {tokenB.symbol} = {formatNumericPrice(1 / liveOraclePrice)} {tokenA.symbol}
                      </span>
                    )}
                  </div>
                ) : liveOracleLoading ? (
                  <span className="text-slate-500 text-[10px] animate-pulse">Fetching rate...</span>
                ) : null}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Trades execute dynamically against real-time market rates verified across Minswap and GeckoTerminal with automated 10% divergence circuit breaker.
              </p>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Straight Spread Percentage (+%)</label>
                <input
                  type="number"
                  step="any"
                  value={spreadPercentInput}
                  onChange={(e) => setSpreadPercentInput(e.target.value)}
                  placeholder="e.g. 1.0%"
                  className="w-full bg-[#121824] border border-[#1f2d44] rounded-xl px-3 py-2 text-xs text-white font-mono outline-none"
                />
                {liveOraclePrice && !isNaN(parsedSpread) && (
                  <div className="p-2 rounded-xl bg-[#121824] border border-[#1f2d44] text-[11px] flex justify-between">
                    <span className="text-slate-400">Straight Effective Rate:</span>
                    <span className="font-mono text-sky-400 font-semibold">
                      1 {tokenA.symbol} = {formatNumericPrice(liveOraclePrice * (1 + parsedSpread / 100))} {tokenB.symbol}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-2 border-t border-[#1a2333]">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={enableReverseOracle}
                    onChange={(e) => setEnableReverseOracle(e.target.checked)}
                    className="rounded border-[#1f2d44] text-sky-500 focus:ring-0 bg-[#121824]"
                  />
                  <span>Enable Reverse Dynamic Leg (Two-Way Automated Market Maker)</span>
                </label>

                {enableReverseOracle && (
                  <div className="space-y-1.5 pl-5">
                    <label className="text-[11px] text-slate-400">Reverse Spread (+%)</label>
                    <input
                      type="number"
                      step="any"
                      value={reverseSpreadPercentInput}
                      onChange={(e) => setReverseSpreadPercentInput(e.target.value)}
                      placeholder="e.g. 1.0%"
                      className="w-full bg-[#121824] border border-[#1f2d44] rounded-xl px-3 py-2 text-xs text-white font-mono outline-none"
                    />
                    {liveOraclePrice && !isNaN(parsedReverseSpread) && (
                      <div className="p-2 rounded-xl bg-[#121824] border border-[#1f2d44] text-[11px] flex justify-between">
                        <span className="text-slate-400">Reverse Effective Rate:</span>
                        <span className="font-mono text-emerald-400 font-semibold">
                          1 {tokenB.symbol} = {formatNumericPrice((1 / liveOraclePrice) * (1 + parsedReverseSpread / 100))} {tokenA.symbol}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Deposit & Fee Summary */}
          <div className="p-3.5 rounded-2xl bg-[#0b0e14] border border-[#1f2d44] space-y-1.5 text-xs text-slate-400">
            <div className="flex justify-between text-slate-300 font-semibold">
              <span>Required ADA Deposit:</span>
              <span className="font-mono text-emerald-400">3.0 ADA (Refundable)</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span>Protocol Maker Flat Fee:</span>
              <span className="font-mono">0.9 ADA</span>
            </div>
            <div className="text-[11px] text-slate-500 pt-1 border-t border-[#1a2333]">
              The 3 ADA deposit is 100% returned to you when the vault is completely filled or cancelled.
            </div>
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div className="flex items-center gap-2 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Success Banner */}
          {txHash && (
            <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>Liquidity Vault Created!</span>
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

          {/* Action Button */}
          {!txHash && (
            <button
              type="button"
              onClick={handleCreate}
              disabled={isSubmitting || !isFormValid}
              className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-sm shadow-lg shadow-sky-500/20 disabled:opacity-40 disabled:pointer-events-none transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Submitting to Cardano Blockchain...</span>
                </>
              ) : (
                <>
                  <PlusCircle className="w-4 h-4" />
                  <span>Create Liquidity Vault</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
