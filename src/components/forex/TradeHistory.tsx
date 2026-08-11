"use client";

import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui";
import type { OrderDisplay } from "@/app/country/[code]/forex/types";

const STATUS_STYLES: Record<string, string> = {
  filled: "bg-success/10 text-success",
  cancelled: "bg-card-elevated text-muted",
  expired: "bg-card-elevated text-muted",
};

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDate(d: Date | string): string {
  const date = new Date(d);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TradeHistory() {
  const [orders, setOrders] = useState<OrderDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/forex/orders?view=history")
      .then((r) => r.json())
      .then((data) => {
        setOrders(data.orders ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load history");
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
        <div className="space-y-1.5 border-b border-card-border px-5 py-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-44" />
        </div>
        <div className="min-h-[240px] space-y-3 p-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-error/20 bg-error/5 p-6 text-center text-error text-sm">
        {error}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8 text-center">
        <p className="text-muted text-sm">No completed trades yet.</p>
        <p className="text-muted/60 text-xs mt-1">
          Executed and cancelled orders will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-card-border">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Trade History
        </h2>
        <p className="text-xs text-muted mt-0.5">Your last {orders.length} completed orders</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border bg-card-elevated">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Date
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
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted hidden md:table-cell">
                Rate
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted hidden md:table-cell">
                Spread
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {orders.map((order, idx) => (
              <tr key={order._id} className={idx % 2 === 0 ? "bg-card" : "bg-card-elevated/30"}>
                <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                  {formatDate(order.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs font-medium text-foreground capitalize">
                    {order.type}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs font-medium text-foreground">
                    {order.fromCurrency} → {order.toCurrency}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-xs text-foreground">
                  {formatAmount(order.amount)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-xs hidden sm:table-cell">
                  {order.filledAmount > 0 ? (
                    <span className="text-success">{formatAmount(order.filledAmount)}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-xs hidden md:table-cell">
                  {"filledRate" in order && order.filledRate != null ? (
                    <span className="text-foreground">
                      {(order.filledRate as number) >= 10
                        ? (order.filledRate as number).toFixed(2)
                        : (order.filledRate as number).toFixed(4)}
                    </span>
                  ) : order.limitRate != null ? (
                    <span className="text-muted">
                      {order.limitRate >= 10
                        ? order.limitRate.toFixed(2)
                        : order.limitRate.toFixed(4)}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-xs text-muted hidden md:table-cell">
                  {order.spreadCharged > 0 ? `-${formatAmount(order.spreadCharged)}` : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                      STATUS_STYLES[order.status] ?? "bg-card-elevated text-muted"
                    }`}
                  >
                    {order.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
