"use client";

import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface TradeEntry {
  _id: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  amount: number;
  rate: number;
  spread: number;
  turn: number;
  createdAt: string;
  buyerName: string | null;
  /** null means the counterparty was the market maker */
  sellerName: string | null;
}

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDate(d: string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PublicTradeHistory() {
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/forex/trades")
      .then((r) => r.json())
      .then((data) => {
        setTrades(data.trades ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load trade feed");
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
        <div className="space-y-1.5 border-b border-card-border px-5 py-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-48" />
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

  if (trades.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8 text-center">
        <p className="text-muted text-sm">No trades in the last 48 turns.</p>
        <p className="text-muted/60 text-xs mt-1">
          All executed market and limit order trades appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-card-border">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Trade Feed</h2>
        <p className="text-xs text-muted mt-0.5">
          All trades in the last 48 turns — {trades.length} shown
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border bg-card-elevated">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Pair
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted hidden sm:table-cell">
                Buyer
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted hidden sm:table-cell">
                Seller
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                Amount
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted hidden md:table-cell">
                Rate
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {trades.map((trade, idx) => (
              <tr key={trade._id} className={idx % 2 === 0 ? "bg-card" : "bg-card-elevated/30"}>
                <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                  {formatDate(trade.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs font-medium text-foreground">
                    {trade.fromCurrency} → {trade.toCurrency}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-foreground hidden sm:table-cell">
                  {trade.buyerName ?? <span className="text-muted italic">Unknown</span>}
                </td>
                <td className="px-4 py-3 text-xs hidden sm:table-cell">
                  {trade.sellerName ? (
                    <span className="text-foreground">{trade.sellerName}</span>
                  ) : (
                    <span className="text-muted italic">Market</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-xs text-foreground">
                  {formatAmount(trade.amount)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-xs text-muted hidden md:table-cell">
                  {trade.rate >= 10 ? trade.rate.toFixed(2) : trade.rate.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
