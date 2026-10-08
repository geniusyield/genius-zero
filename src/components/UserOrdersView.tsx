import React, { useState } from "react";
import { Trash2, AlertCircle, Loader2, ExternalLink, ArrowRight } from "lucide-react";
import { useApp } from "../context/AppContext";
import { DexOrder } from "../types";

export const UserOrdersView: React.FC = () => {
  const { userOrders, wallet, cancelOrder, actionPending, settings } = useApp();
  const [cancelingRef, setCancelingRef] = useState<string | null>(null);

  const handleCancel = async (order: DexOrder) => {
    const refKey = `${order.utxoRef.txHash}#${order.utxoRef.outputIndex}`;
    setCancelingRef(refKey);
    try {
      await cancelOrder(order);
    } catch (err) {
      console.error(err);
    } finally {
      setCancelingRef(null);
    }
  };

  const formatUnit = (unit: string) => {
    if (unit === "lovelace" || unit === "") return "ADA";
    if (unit.includes("47454e53")) return "GENS";
    if (unit.includes("534e454b")) return "SNEK";
    if (unit.includes("4e4d4b52")) return "NMKR";
    if (unit.includes("494147")) return "IAG";
    if (unit.includes("444a4544")) return "DJED";
    if (unit.includes("545354")) return "TST";
    return `${unit.slice(0, 6)}...`;
  };

  const getDecimals = (unit: string) => {
    if (unit === "lovelace" || unit === "") return 6;
    if (unit.includes("47454e53")) return 6; // GENS has 6 decimals
    if (unit.includes("444a4544")) return 6; // DJED has 6 decimals
    return 0;
  };

  const formatAmount = (amt: bigint, unit: string) => {
    const decimals = getDecimals(unit);
    return (Number(amt) / Math.pow(10, decimals)).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  };

  const formatPrice = (p: number) => {
    if (p <= 0) return "0.00";
    if (p < 0.0001) return p.toExponential(4);
    if (p < 1) return p.toFixed(6);
    return p.toFixed(4);
  };

  const explorerBaseUrl =
    settings.network === "mainnet"
      ? "https://cardanoscan.io/transaction"
      : "https://preprod.cardanoscan.io/transaction";

  return (
    <div className="bg-[#121824] border border-[#1f2d44] rounded-2xl overflow-hidden shadow-xl p-5">
      <div className="flex items-center justify-between pb-3 border-b border-[#1f2d44] mb-4">
        <div>
          <h3 className="font-bold text-sm text-white">My Open Orders</h3>
          <p className="text-xs text-slate-400">
            Active on-chain orders created by your wallet in the DEX smart contract
          </p>
        </div>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#182234] text-slate-300 border border-[#1f2d44]">
          {userOrders.length} {userOrders.length === 1 ? "Order" : "Orders"}
        </span>
      </div>

      {!wallet.connected ? (
        <div className="text-center py-10 space-y-2">
          <AlertCircle className="w-8 h-8 text-slate-500 mx-auto" />
          <p className="text-xs text-slate-400">Connect your wallet to inspect and cancel your open orders</p>
        </div>
      ) : userOrders.length === 0 ? (
        <div className="text-center py-10 space-y-2">
          <p className="text-xs text-slate-500 italic">You have no active orders in the DEX smart contract</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-[#1f2d44] text-[10px] text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Direction (Put In → Want Out)</th>
                  <th className="py-2.5 px-3">Offered (Deposited)</th>
                  <th className="py-2.5 px-3">Exchange Rate (Both Directions)</th>
                  <th className="py-2.5 px-3">Refundable Deposit</th>
                  <th className="py-2.5 px-3">UTxO Ref</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1f2d44]/50">
                {userOrders.map((order) => {
                  const refKey = `${order.utxoRef.txHash}#${order.utxoRef.outputIndex}`;
                  const isCanceling = cancelingRef === refKey && actionPending;

                  const offerSym = formatUnit(order.offeredAsset);
                  const askSym = formatUnit(order.askedAsset);
                  const offDec = getDecimals(order.offeredAsset);
                  const askDec = getDecimals(order.askedAsset);

                  // Rate: 1 offeredToken = (num * 10^offDec) / (den * 10^askDec) askedTokens
                  const rateNum = Number(order.price.numerator) * Math.pow(10, offDec);
                  const rateDen = Number(order.price.denominator) * Math.pow(10, askDec);
                  const rate = rateDen > 0 ? rateNum / rateDen : 0;
                  const reciprocal = rate > 0 ? 1 / rate : 0;

                  return (
                    <tr key={refKey} className="hover:bg-[#182234]/50 transition-colors">
                      {/* Direction */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141b27] border border-[#1f2d44] text-[11px]">
                            <span className="font-bold text-emerald-400">{offerSym}</span>
                            <ArrowRight className="w-3 h-3 text-slate-500" />
                            <span className="font-bold text-slate-200">{askSym}</span>
                          </div>
                          {order.isExpired && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Expired
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Offered Amount */}
                      <td className="py-3 px-3 text-slate-200">
                        <span className="font-bold">{formatAmount(order.offeredAmount, order.offeredAsset)}</span>{" "}
                        <span className="text-slate-400">{offerSym}</span>
                      </td>

                      {/* Exchange Rate */}
                      <td className="py-3 px-3">
                        <div className="text-slate-200 font-semibold">
                          1 {offerSym} = {formatPrice(rate)} {askSym}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          (1 {askSym} = {formatPrice(reciprocal)} {offerSym})
                        </div>
                      </td>

                      {/* Locked Refundable Deposit */}
                      <td className="py-3 px-3 text-slate-400">
                        {(Number(order.depositLovelace) / 1_000_000).toFixed(2)} ADA
                      </td>

                      {/* UTxO Ref */}
                      <td className="py-3 px-3">
                        <a
                          href={`${explorerBaseUrl}/${order.utxoRef.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:underline flex items-center gap-1"
                        >
                          <span>{order.utxoRef.txHash.slice(0, 6)}...#{order.utxoRef.outputIndex}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>

                      {/* Cancel Action */}
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleCancel(order)}
                          disabled={actionPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold transition-all disabled:opacity-50"
                        >
                          {isCanceling ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                          <span>Cancel & Refund</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View (< md) */}
          <div className="md:hidden space-y-3">
            {userOrders.map((order) => {
              const refKey = `${order.utxoRef.txHash}#${order.utxoRef.outputIndex}`;
              const isCanceling = cancelingRef === refKey && actionPending;

              const offerSym = formatUnit(order.offeredAsset);
              const askSym = formatUnit(order.askedAsset);
              const offDec = getDecimals(order.offeredAsset);
              const askDec = getDecimals(order.askedAsset);

              const rateNum = Number(order.price.numerator) * Math.pow(10, offDec);
              const rateDen = Number(order.price.denominator) * Math.pow(10, askDec);
              const rate = rateDen > 0 ? rateNum / rateDen : 0;

              return (
                <div
                  key={`mobile-${refKey}`}
                  className="p-3.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-3"
                >
                  {/* Top Row: Direction Pill + Cancel Button */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#141b27] border border-[#1f2d44] text-xs font-mono">
                        <span className="font-bold text-emerald-400">{offerSym}</span>
                        <ArrowRight className="w-3 h-3 text-slate-500" />
                        <span className="font-bold text-slate-200">{askSym}</span>
                      </div>
                      {order.isExpired && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          Expired
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCancel(order)}
                      disabled={actionPending}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold transition-all disabled:opacity-50"
                    >
                      {isCanceling ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                      <span>Cancel</span>
                    </button>
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-[#121824] p-2.5 rounded-lg border border-[#1a2332]">
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase">Offered</div>
                      <div className="font-bold text-white text-sm">
                        {formatAmount(order.offeredAmount, order.offeredAsset)} <span className="text-slate-400 text-xs">{offerSym}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase">Exchange Rate</div>
                      <div className="font-semibold text-slate-200">
                        {formatPrice(rate)} <span className="text-[10px] text-slate-400">{askSym}</span>
                      </div>
                    </div>
                  </div>

                  {/* Footer: Deposit & Cardanoscan link */}
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-0.5">
                    <div>
                      Refundable: <span className="text-slate-200">{(Number(order.depositLovelace) / 1_000_000).toFixed(2)} ADA</span>
                    </div>
                    <a
                      href={`${explorerBaseUrl}/${order.utxoRef.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-400 hover:underline flex items-center gap-1"
                    >
                      <span>Tx {order.utxoRef.txHash.slice(0, 6)}...</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
