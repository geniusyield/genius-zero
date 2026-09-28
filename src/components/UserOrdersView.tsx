import React, { useState } from "react";
import { Trash2, AlertCircle, Loader2, ExternalLink } from "lucide-react";
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
    if (unit === "lovelace") return "ADA";
    if (unit.includes("47454e53")) return "GENS";
    if (unit.includes("534e454b")) return "SNEK";
    if (unit.includes("4e4d4b52")) return "NMKR";
    if (unit.includes("494147")) return "IAG";
    if (unit.includes("444a4544")) return "DJED";
    return `${unit.slice(0, 6)}...`;
  };

  const formatAmount = (amt: bigint, unit: string) => {
    const decimals = unit === "lovelace" || unit.includes("47454e53") ? 6 : 0;
    return (Number(amt) / Math.pow(10, decimals)).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
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
            Active orders placed by your wallet on the Cardano DEX smart contract
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
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-[#1f2d44] text-[10px] text-slate-500 uppercase tracking-wider">
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Offered</th>
                <th className="py-2.5 px-3">Asked</th>
                <th className="py-2.5 px-3">Locked Deposit</th>
                <th className="py-2.5 px-3">UTxO Ref</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f2d44]/50">
              {userOrders.map((order) => {
                const refKey = `${order.utxoRef.txHash}#${order.utxoRef.outputIndex}`;
                const isCanceling = cancelingRef === refKey && actionPending;

                return (
                  <tr key={refKey} className="hover:bg-[#182234]/50 transition-colors">
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          order.orderType === "bid"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }`}
                      >
                        {order.orderType === "bid" ? "Buy" : "Sell"}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-200">
                      {formatAmount(order.offeredAmount, order.offeredAsset)}{" "}
                      <span className="text-slate-400">{formatUnit(order.offeredAsset)}</span>
                    </td>
                    <td className="py-3 px-3 text-slate-200">
                      <span className="text-slate-400">{formatUnit(order.askedAsset)}</span>
                    </td>
                    <td className="py-3 px-3 text-slate-400">
                      {(Number(order.depositLovelace) / 1_000_000).toFixed(2)} ADA
                    </td>
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
                        <span>Cancel</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
