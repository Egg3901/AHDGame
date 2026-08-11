"use client";

import { useState, useMemo } from "react";
import type { OrderDisplay } from "@/app/country/[code]/forex/types";

interface Props {
  orders: OrderDisplay[];
  onFilled?: () => void;
}

function formatRate(rate: number): string {
  if (rate >= 10) return rate.toFixed(2);
  return rate.toFixed(4);
}

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function OrderBook({ orders, onFilled }: Props) {
  const [filling, setFilling] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pairFilter, setPairFilter] = useState("all");

  const openOrders = orders.filter((o) => o.status === "open" || o.status === "partial");

  // Build unique pair list for filter
  const pairs = useMemo(() => {
    const set = new Set(openOrders.map((o) => `${o.fromCurrency}/${o.toCurrency}`));
    return Array.from(set).sort();
  }, [openOrders]);

  const filtered =
    pairFilter === "all"
      ? openOrders
      : openOrders.filter((o) => `${o.fromCurrency}/${o.toCurrency}` === pairFilter);

  const handleFill = async (orderId: string) => {
    setFilling(orderId);
    try {
      const res = await fetch(`/api/forex/orders/${orderId}/fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to fill order");
      } else {
        onFilled?.();
      }
    } catch {
      setError("Network error");
    } finally {
      setFilling(null);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      {error && (
        <div className="mb-4 rounded-lg border border-error/20 bg-error/5 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}
      <div className="px-5 py-4 border-b border-card-border flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Order Book</h2>
          <p className="text-xs text-muted mt-0.5">Open limit orders from other players</p>
        </div>
        {pairs.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setPairFilter("all")}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                pairFilter === "all"
                  ? "bg-primary/10 text-primary"
                  : "bg-card-elevated text-muted hover:text-foreground"
              }`}
            >
              All
            </button>
            {pairs.map((pair) => (
              <button
                key={pair}
                type="button"
                onClick={() => setPairFilter(pair)}
                className={`rounded-full px-2.5 py-1 text-xs font-mono font-medium transition-colors ${
                  pairFilter === pair
                    ? "bg-primary/10 text-primary"
                    : "bg-card-elevated text-muted hover:text-foreground"
                }`}
              >
                {pair}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border bg-card-elevated">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Trader
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Pair
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                Amount
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                Limit Rate
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted hidden sm:table-cell">
                Filled
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  {openOrders.length === 0
                    ? "No open orders on the book."
                    : `No orders for ${pairFilter}.`}
                </td>
              </tr>
            ) : (
              filtered.map((o, idx) => {
                const remaining = o.amount - o.filledAmount;
                const filledPct =
                  o.amount > 0 ? ((o.filledAmount / o.amount) * 100).toFixed(0) : "0";
                return (
                  <tr key={o._id} className={idx % 2 === 0 ? "bg-card" : "bg-card-elevated/50"}>
                    <td className="px-4 py-3 font-medium text-foreground text-sm">
                      {o.characterName}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-medium">
                        {o.fromCurrency} → {o.toCurrency}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-xs">
                      {formatAmount(remaining)}
                      <span className="ml-1 text-[10px] text-muted">{o.fromCurrency}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-xs">
                      {o.limitRate != null ? formatRate(o.limitRate) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">
                      <span className="text-xs tabular-nums text-muted">{filledPct}%</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleFill(o._id)}
                        disabled={filling === o._id}
                        className="rounded-md bg-primary px-3 py-1 text-xs font-bold text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {filling === o._id ? "..." : "Fill"}
                      </button>
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
