"use client";

/**
 * The player's OWN share-trade history with realized P&L (suggestion #38).
 *
 * Distinct from the per-corporation public tape at
 * `/api/corporations/[id]/shares/history`, which shows every holder's trades on
 * one corporation. This shows one holder's trades across every corporation,
 * with a FIFO cost basis so "did I actually make money" has an answer.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatStableUtc } from "@/lib/time/localTime";
import { useCurrency } from "@/contexts/CurrencyContext";

interface TradeEntry {
  tradeId: string;
  corporationId: string;
  corporationName: string;
  corporationTicker: string | null;
  kind: string;
  turn: number;
  createdAt: string;
  side: "buy" | "sell";
  shares: number;
  pricePerShareAnchor: number;
  totalAnchor: number;
  counterparty: string;
  realizedPnlAnchor: number | null;
  costBasisAnchor: number | null;
}

interface PositionSummary {
  corporationId: string;
  corporationName: string;
  corporationTicker: string | null;
  realizedPnlAnchor: number;
  openShares: number;
  openCostPerShareAnchor: number | null;
  hasUnmatchedSales: boolean;
}

interface TradeHistoryResponse {
  totalRealizedPnlAnchor: number;
  hasUnmatchedSales: boolean;
  entries: TradeEntry[];
  positions: PositionSummary[];
}

const formatShares = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const formatWhen = (iso: string) =>
  formatStableUtc(iso, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function TradeHistoryPanel() {
  const { formatAmount } = useCurrency();
  const [data, setData] = useState<TradeHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portfolio/trade-history", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setError("Could not load your trade history. Please try again.");
          return;
        }
        const json = (await res.json()) as TradeHistoryResponse;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError("Could not load your trade history. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-muted">Loading your trade history…</p>;
  }
  if (error) {
    return <p className="text-sm text-error">{error}</p>;
  }
  if (!data || data.entries.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        <h2 className="text-lg font-bold text-foreground">Trade history</h2>
        <p className="text-sm text-muted mt-1">
          You have not traded any shares yet. Buys and sells show up here with what you made or lost
          on each one.
        </p>
      </div>
    );
  }

  const pnlClass = (v: number) =>
    v > 0 ? "text-success" : v < 0 ? "text-error" : "text-foreground";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">Realized profit and loss</h2>
            <p className="text-xs text-muted mt-0.5 max-w-prose">
              What you actually made on shares you have already sold. Shares you still hold are not
              counted here. Sales are matched against your oldest shares first.
            </p>
          </div>
          <p
            className={`text-3xl font-black tabular-nums ${pnlClass(data.totalRealizedPnlAnchor)}`}
          >
            {formatAmount(data.totalRealizedPnlAnchor)}
          </p>
        </div>
        {data.hasUnmatchedSales && (
          <p className="text-xs text-warning mt-3">
            Some sales are from shares bought before trade records began, so their profit cannot be
            worked out. Those sales are left out of the total.
          </p>
        )}
      </div>

      {data.positions.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
          <h3 className="text-sm font-bold text-foreground mb-3">By corporation</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="pb-2 pr-4 font-semibold">Corporation</th>
                  <th className="pb-2 pr-4 font-semibold text-right">Realized</th>
                  <th className="pb-2 pr-4 font-semibold text-right">Still held</th>
                  <th className="pb-2 font-semibold text-right">Avg cost</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => (
                  <tr key={p.corporationId} className="border-t border-card-border">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/corporation/${p.corporationId}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {p.corporationTicker ?? p.corporationName}
                      </Link>
                    </td>
                    <td
                      className={`py-2 pr-4 text-right tabular-nums font-semibold ${pnlClass(p.realizedPnlAnchor)}`}
                    >
                      {formatAmount(p.realizedPnlAnchor)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-foreground">
                      {formatShares(p.openShares)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted">
                      {p.openCostPerShareAnchor == null
                        ? "—"
                        : formatAmount(p.openCostPerShareAnchor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
        <h3 className="text-sm font-bold text-foreground mb-3">Every trade</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted">
                <th className="pb-2 pr-4 font-semibold">When</th>
                <th className="pb-2 pr-4 font-semibold">Corporation</th>
                <th className="pb-2 pr-4 font-semibold">Side</th>
                <th className="pb-2 pr-4 font-semibold text-right">Shares</th>
                <th className="pb-2 pr-4 font-semibold text-right">Price</th>
                <th className="pb-2 pr-4 font-semibold text-right">Total</th>
                <th className="pb-2 font-semibold text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.tradeId} className="border-t border-card-border">
                  <td className="py-2 pr-4 whitespace-nowrap text-muted">
                    {formatWhen(e.createdAt)}
                  </td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/corporation/${e.corporationId}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      {e.corporationTicker ?? e.corporationName}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`font-semibold ${e.side === "buy" ? "text-success" : "text-warning"}`}
                    >
                      {e.side === "buy" ? "Bought" : "Sold"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatShares(e.shares)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatAmount(e.pricePerShareAnchor)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatAmount(e.totalAnchor)}
                  </td>
                  <td
                    className={`py-2 text-right tabular-nums font-semibold ${
                      e.realizedPnlAnchor == null ? "text-muted" : pnlClass(e.realizedPnlAnchor)
                    }`}
                  >
                    {e.side === "buy"
                      ? "—"
                      : e.realizedPnlAnchor == null
                        ? "Unknown"
                        : formatAmount(e.realizedPnlAnchor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
