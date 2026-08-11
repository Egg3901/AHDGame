"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Skeleton } from "@/components/ui";
import { FundTradePanel } from "@/components/indexFunds/FundTradePanel";
import { legacyAdjustedDisplayUnits } from "@/lib/indexFunds/unitAccounting";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface FundPosition {
  fundId: string;
  slug: string | null;
  name: string | null;
  tickerSymbol: string | null;
  anchorCurrencyCode: string | null;
  units: number;
  legacyUnits: number | null;
  avgNavAnchor: number | null;
  currentNav: number | null;
  marketValueAnchor: number | null;
  status: string | null;
}

interface FundTransaction {
  id: string;
  fundId: string;
  kind: string;
  units: number | null;
  navAnchor: number | null;
  amountAnchor: number;
  note: string | null;
  createdAt: string;
}

export function FundHoldingsPanel({
  characterId,
  stockMarketHref = "/country/us/stockmarket?tab=funds",
}: {
  characterId: string;
  stockMarketHref?: string;
}) {
  const { formatAmount, forexEnabled, forexRates } = useCurrency();

  // #857 grandfather: legacy units redeem rate-free, so the display layer's
  // × rate step over-states their value ~100×. Discount the ₳ figures by the
  // legacy fraction so Value / P&L / Avg NAV match what the holder can redeem.
  const legacyAdjFactor = useCallback(
    (pos: FundPosition): number => {
      if (pos.units <= 0) return 1;
      const rate = forexEnabled
        ? (forexRates?.[(pos.anchorCurrencyCode ?? "USD") as CurrencyCode] ?? 1)
        : 1;
      const adjUnits = legacyAdjustedDisplayUnits({
        units: pos.units,
        legacyUnits: pos.legacyUnits ?? pos.units,
        fundFxRate: rate,
        forexEnabled,
      });
      return adjUnits / pos.units;
    },
    [forexEnabled, forexRates]
  );
  const [positions, setPositions] = useState<FundPosition[]>([]);
  const [transactions, setTransactions] = useState<FundTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState("");
  const [expandedFundId, setExpandedFundId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/character/${characterId}/fund-portfolio`, {
        cache: "no-store",
      });
      if (res.status === 403) {
        setDisabled(true);
        setPositions([]);
        return;
      }
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error || "Failed to load fund portfolio");
        return;
      }
      const data = (await res.json()) as {
        positions: FundPosition[];
        transactions: FundTransaction[];
      };
      setPositions(data.positions ?? []);
      setTransactions(data.transactions ?? []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (disabled) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center text-sm text-muted">
        Index funds are not enabled on this server.
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

  const totalValue = positions.reduce(
    (s, p) => s + (p.marketValueAnchor ?? 0) * legacyAdjFactor(p),
    0
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
        <p className="text-[10px] uppercase tracking-widest text-muted font-semibold">
          Total fund holdings
        </p>
        <p className="text-2xl font-bold tabular-nums mt-1">{formatAmount(totalValue)}</p>
        <p className="text-xs text-muted mt-1">
          Browse and subscribe on the{" "}
          <Link href={stockMarketHref} className="text-primary hover:underline">
            stock market Funds tab
          </Link>
          .
        </p>
      </div>

      {positions.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center text-sm text-muted">
          You do not hold any index fund units yet.
        </div>
      ) : (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-card-elevated border-b border-card-border text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Fund</th>
                <th className="px-4 py-3 text-right">Units</th>
                <th className="px-4 py-3 text-right hidden sm:table-cell">Avg NAV</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3 text-right">P&amp;L</th>
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {positions.map((pos) => {
                const ccy = (pos.anchorCurrencyCode ?? "USD") as CurrencyCode;
                const adj = legacyAdjFactor(pos);
                const costBasis =
                  pos.avgNavAnchor != null ? pos.units * pos.avgNavAnchor * adj : null;
                const market = (pos.marketValueAnchor ?? 0) * adj;
                const pnl = costBasis != null && costBasis > 0 ? market - costBasis : null;
                const pnlPct =
                  pnl != null && costBasis != null && costBasis > 0
                    ? (pnl / costBasis) * 100
                    : null;
                const isExpanded = expandedFundId === (pos.slug ?? pos.fundId);
                const fundSlug = pos.slug ?? pos.fundId;
                const fundDetailHref = stockMarketHref.includes("/stockmarket")
                  ? stockMarketHref
                      .replace(/\?.*$/, "")
                      .replace(/\/stockmarket\/?$/, `/stockmarket/fund/${fundSlug}`)
                  : `${stockMarketHref.replace(/\?.*$/, "")}/fund/${fundSlug}`;

                return (
                  <Fragment key={pos.fundId}>
                    <tr className="hover:bg-card-elevated/40">
                      <td className="px-4 py-3">
                        <Link href={fundDetailHref} className="font-semibold hover:text-primary">
                          <span className="font-mono text-primary text-xs mr-2">
                            {pos.tickerSymbol}
                          </span>
                          {pos.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {pos.units.toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">
                        {pos.avgNavAnchor != null ? formatAmount(pos.avgNavAnchor * adj, ccy) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {formatAmount(market, ccy)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums text-xs font-semibold ${
                          pnl != null && pnl >= 0 ? "text-success" : "text-error"
                        }`}
                      >
                        {pnl != null ? (
                          <>
                            {pnl >= 0 ? "+" : ""}
                            {formatAmount(pnl, ccy)}
                            {pnlPct != null && (
                              <span className="block text-[10px] opacity-80">
                                {pnlPct >= 0 ? "+" : ""}
                                {pnlPct.toFixed(1)}%
                              </span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setExpandedFundId(isExpanded ? null : fundSlug)}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          {isExpanded ? "Close" : "Redeem"}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && pos.currentNav != null && (
                      <tr>
                        <td colSpan={6} className="px-4 py-4 bg-card-elevated/30">
                          <FundTradePanel
                            fundId={pos.slug ?? pos.fundId}
                            quotedNav={pos.currentNav}
                            anchorCurrencyCode={pos.anchorCurrencyCode ?? "USD"}
                            status={pos.status ?? "active"}
                            myUnits={pos.units}
                            myLegacyUnits={pos.legacyUnits ?? pos.units}
                            defaultMode="redeem"
                            onSuccess={() => {
                              setExpandedFundId(null);
                              void load();
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {transactions.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
          <div className="bg-card-elevated px-4 py-3 border-b border-card-border">
            <h3 className="text-sm font-semibold">Recent activity</h3>
          </div>
          <ul className="divide-y divide-card-border text-sm">
            {transactions.slice(0, 15).map((tx) => (
              <li
                key={tx.id}
                className="px-4 py-3 flex flex-wrap items-center justify-between gap-2"
              >
                <span className="capitalize text-muted">{tx.kind.replace(/_/g, " ")}</span>
                <span className="tabular-nums font-medium">
                  {tx.units != null ? `${tx.units} units · ` : ""}
                  {formatAmount(tx.amountAnchor)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
