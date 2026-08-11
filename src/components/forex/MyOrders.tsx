"use client";

import { useState } from "react";
import type { OrderDisplay } from "@/app/country/[code]/forex/types";
import { formatStableUtc } from "@/lib/time/localTime";

interface Props {
  orders: OrderDisplay[];
  onOrderCancelled: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  partial: "bg-warning/10 text-warning",
  filled: "bg-success/10 text-success",
  cancelled: "bg-card-elevated text-muted",
  expired: "bg-card-elevated text-muted",
};

function formatRate(rate: number): string {
  if (rate >= 10) return rate.toFixed(2);
  return rate.toFixed(4);
}

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDate(d: string | Date): string {
  // Deterministic (UTC) so SSR and client agree — avoids hydration error #418.
  return formatStableUtc(d, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MyOrders({ orders, onOrderCancelled }: Props) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState("");

  const handleCancel = async (orderId: string) => {
    setCancelling(orderId);
    try {
      const res = await fetch(`/api/forex/orders/${orderId}`, { method: "DELETE" });
      if (res.ok) onOrderCancelled();
      else {
        const data = await res.json();
        setError(data.error ?? "Failed to cancel order");
      }
    } catch {
      setError("Network error");
    } finally {
      setCancelling(null);
    }
  };

  const sorted = [...orders].sort((a, b) => {
    const aActive = a.status === "open" || a.status === "partial" ? 0 : 1;
    const bActive = b.status === "open" || b.status === "partial" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      {error && (
        <div className="mb-4 rounded-lg border border-error/20 bg-error/5 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}
      <div className="px-5 py-4 border-b border-card-border">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">My Orders</h2>
        <p className="text-xs text-muted mt-0.5">Open and partially filled orders</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border bg-card-elevated">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Placed
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Pair
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                Amount
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted hidden sm:table-cell">
                Filled
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                Rate
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted hidden md:table-cell">
                Fee
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted hidden lg:table-cell">
                Expires
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-muted">
                Status
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-muted">
                  You have no open orders.
                </td>
              </tr>
            ) : (
              sorted.map((o, idx) => {
                const canCancel = o.status === "open" || o.status === "partial";
                const filledPct =
                  o.amount > 0 ? ((o.filledAmount / o.amount) * 100).toFixed(0) : "0";
                return (
                  <tr key={o._id} className={idx % 2 === 0 ? "bg-card" : "bg-card-elevated/50"}>
                    <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                      {formatDate(o.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-card-elevated border border-card-border px-2 py-0.5 text-[10px] font-bold uppercase">
                        {o.type}
                      </span>
                      {o.type === "direct" && o.targetCharacterName && (
                        <span className="ml-1.5 text-xs text-muted">→ {o.targetCharacterName}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-medium">
                        {o.fromCurrency} → {o.toCurrency}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-xs">
                      {formatAmount(o.amount)}
                      <span className="ml-1 text-[10px] text-muted">{o.fromCurrency}</span>
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">
                      <span className="text-xs tabular-nums">
                        {o.filledAmount > 0 ? (
                          <span className="text-success">{formatAmount(o.filledAmount)}</span>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                        <span className="text-muted ml-1">({filledPct}%)</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-xs">
                      {o.limitRate != null ? (
                        formatRate(o.limitRate)
                      ) : (
                        <span className="text-muted">market</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-xs text-muted hidden md:table-cell">
                      {o.spreadCharged > 0 ? `-${formatAmount(o.spreadCharged)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted hidden lg:table-cell">
                      {o.expiresAtTurn != null ? `T${o.expiresAtTurn}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${STATUS_STYLES[o.status] ?? ""}`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canCancel ? (
                        <button
                          onClick={() => handleCancel(o._id)}
                          disabled={cancelling === o._id}
                          className="rounded-md border border-error/30 px-3 py-1 text-xs font-bold text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                        >
                          {cancelling === o._id ? "..." : "Cancel"}
                        </button>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
