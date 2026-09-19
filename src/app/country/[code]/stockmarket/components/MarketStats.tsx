"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Tooltip } from "@/components/ui";
import { resolveListingColor } from "../stockMarketColors";
import type { BondListing, CommodityData, MarketCapPoint, StockListing } from "../types";
import { SectorPieChart } from "./SectorPieChart";

const CHART_W = 700;
const CHART_H = 240;
const PAD = { top: 16, right: 20, bottom: 40, left: 72 };

/** Distinct series colors (theme-agnostic, readable on dark cards) */
const SERIES_COLORS = [
  "var(--primary)",
  "var(--success)",
  "#a855f7",
  "#f97316",
  "#06b6d4",
  "var(--muted)",
];

/** Fixed palette for sector market-cap pie (not per-corporation) */
const SECTOR_PIE_PALETTE = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#22c55e",
  "#14b8a6",
  "#ef4444",
  "#6366f1",
  "#f97316",
  "#06b6d4",
  "#84cc16",
  "#a855f7",
  "#0ea5e9",
  "#eab308",
  "#64748b",
];

export type SectorMetricKey = "revenue" | "profit" | "marketCap" | "sharePrice" | "dividendRate";

const METRIC_OPTIONS: { key: SectorMetricKey; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "profit", label: "Profit" },
  { key: "marketCap", label: "Market cap" },
  { key: "sharePrice", label: "Share price" },
  { key: "dividendRate", label: "Dividend %" },
];

function getMetric(l: StockListing, m: SectorMetricKey): number {
  // Cross-corp bars compare per-listing magnitudes against one another. Post-v0.2.6
  // listings can denominate in different currencies, so use the ₳-normalized
  // mirrors when present; pre-forex rows fall through unchanged.
  switch (m) {
    case "revenue":
      return l.totalRevenueAnchor ?? l.totalRevenue;
    case "profit":
      return l.incomeAnchor ?? l.income;
    case "marketCap":
      return l.marketCapAnchor ?? l.marketCap;
    case "sharePrice":
      return l.sharePriceAnchor ?? l.sharePrice;
    case "dividendRate":
      return l.dividendRate ?? 0;
  }
}

function makeMetricFormatter(
  formatAmount: (v: number) => string,
  formatPrice: (v: number) => string
) {
  return function formatMetricValue(m: SectorMetricKey, v: number): string {
    switch (m) {
      case "revenue":
      case "profit":
      case "marketCap":
        return formatAmount(v);
      case "sharePrice":
        return formatPrice(v);
      case "dividendRate":
        return `${v.toFixed(2)}%`;
    }
  };
}

function barWidthPct(values: number[], v: number): number {
  if (values.length === 0) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return 100;
  return ((v - min) / (max - min)) * 100;
}

function weightedDividendByMcap(ls: StockListing[]): number {
  // Aggregate in ₳ — listings may carry different liquidCurrencyCodes.
  const mcap = ls.reduce((s, x) => s + (x.marketCapAnchor ?? x.marketCap), 0);
  if (mcap <= 0) return 0;
  return (
    ls.reduce((s, x) => s + (x.dividendRate ?? 0) * (x.marketCapAnchor ?? x.marketCap), 0) / mcap
  );
}

type SectorRow = {
  type: CorporationType;
  label: string;
  count: number;
  marketCap: number;
  totalRevenue: number;
  weightedRoi: number;
  avgGrowth: number;
};

function sumBySector(pt: MarketCapPoint): number {
  if (!pt.bySector) return 0;
  return Object.values(pt.bySector).reduce((a, b) => a + (b ?? 0), 0);
}

export function MarketStats({
  listings,
  commodities,
  bondListings,
  history,
}: {
  listings: StockListing[];
  commodities: CommodityData[];
  bondListings: BondListing[];
  history: MarketCapPoint[];
}) {
  const { formatAmount, formatPrice } = useCurrency();
  const formatMetricValue = makeMetricFormatter(formatAmount, formatPrice);
  const [metric, setMetric] = useState<SectorMetricKey>("marketCap");

  const groupedListings = useMemo(() => {
    const m = new Map<CorporationType, StockListing[]>();
    for (const l of listings) {
      const arr = m.get(l.type) ?? [];
      arr.push(l);
      m.set(l.type, arr);
    }
    for (const [, arr] of m) {
      arr.sort((a, b) => (b.marketCapAnchor ?? b.marketCap) - (a.marketCapAnchor ?? a.marketCap));
    }
    return m;
  }, [listings]);

  const sectorRows = useMemo(() => {
    // Sector aggregates cross listings with potentially different currencies.
    // Sum the ₳ mirrors so per-sector totals are currency-comparable; display
    // helpers then format without a nativeCurrencyCode (ambient ₳).
    const rows: SectorRow[] = [];
    for (const [type, ls] of groupedListings) {
      const marketCap = ls.reduce((s, x) => s + (x.marketCapAnchor ?? x.marketCap), 0);
      const totalRevenue = ls.reduce((s, x) => s + (x.totalRevenueAnchor ?? x.totalRevenue), 0);
      const weightedRoi =
        marketCap > 0
          ? ls.reduce(
              (s, x) => s + (x.priceChange24h ?? 0) * (x.marketCapAnchor ?? x.marketCap),
              0
            ) / marketCap
          : 0;
      const avgGrowth =
        ls.length > 0 ? ls.reduce((s, x) => s + (x.avgSectorGrowth ?? 0), 0) / ls.length : 0;
      rows.push({
        type,
        label: CORPORATION_TYPE_LABELS[type],
        count: ls.length,
        marketCap,
        totalRevenue,
        weightedRoi,
        avgGrowth,
      });
    }
    rows.sort((a, b) => b.marketCap - a.marketCap);
    return rows;
  }, [groupedListings]);

  const totalMcap = useMemo(() => sectorRows.reduce((s, r) => s + r.marketCap, 0), [sectorRows]);

  const pieSlices = useMemo(() => {
    if (totalMcap <= 0 || sectorRows.length === 0) return [];
    return sectorRows.map((row, i) => ({
      label: row.label,
      pct: (row.marketCap / totalMcap) * 100,
      color: SECTOR_PIE_PALETTE[i % SECTOR_PIE_PALETTE.length],
    }));
  }, [sectorRows, totalMcap]);

  const bondSnapshot = useMemo(() => {
    const corporate = bondListings.filter((b) => b.issuerType !== "sovereign").length;
    const sovereign = bondListings.filter((b) => b.issuerType === "sovereign").length;
    const defaulted = bondListings.filter((b) => b.defaulted).length;
    const totalFloat = bondListings.reduce((s, b) => s + (b.publicFloat ?? 0), 0);
    return { corporate, sovereign, defaulted, totalFloat };
  }, [bondListings]);

  const multiSeries = useMemo(() => {
    if (history.length < 2) return null;
    const last = history[history.length - 1];
    if (!last.bySector || Object.keys(last.bySector).length === 0) return null;

    const ranked = Object.entries(last.bySector)
      .filter(([, v]) => (v ?? 0) > 0)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(([k]) => k as CorporationType);
    const topKeys = ranked.slice(0, 5);

    const seriesKeys: { key: CorporationType | "other"; label: string }[] = [
      ...topKeys.map((k) => ({ key: k, label: CORPORATION_TYPE_LABELS[k] })),
    ];

    const hasOther = ranked.length > 5;
    if (hasOther) {
      seriesKeys.push({ key: "other", label: "Other sectors" });
    }

    const innerW = CHART_W - PAD.left - PAD.right;
    const innerH = CHART_H - PAD.top - PAD.bottom;
    const turns = history.map((p) => p.turn);
    const minTurn = turns[0];
    const maxTurn = turns[turns.length - 1];

    const valuesAt = (pt: MarketCapPoint, key: CorporationType | "other"): number => {
      if (key === "other") {
        const total = sumBySector(pt);
        const topSum = topKeys.reduce((s, k) => s + (pt.bySector?.[k] ?? 0), 0);
        return Math.max(0, total - topSum);
      }
      return pt.bySector?.[key] ?? 0;
    };

    let maxVal = 0;
    for (const pt of history) {
      for (const { key } of seriesKeys) {
        maxVal = Math.max(maxVal, valuesAt(pt, key));
      }
    }
    const capPad = maxVal * 0.08 || maxVal * 0.05 || 1;
    const yMin = 0;
    const yMax = maxVal + capPad;

    const xScale = (turn: number) =>
      PAD.left + ((turn - minTurn) / Math.max(maxTurn - minTurn, 1)) * innerW;
    const yScale = (val: number) => PAD.top + innerH - ((val - yMin) / (yMax - yMin)) * innerH;

    const paths = seriesKeys.map(({ key }, idx) => {
      const pts = history.map((p, i) => {
        const v = valuesAt(p, key);
        const x = xScale(p.turn);
        const y = yScale(v);
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      });
      return {
        key: String(key),
        d: pts.join(" "),
        color: SERIES_COLORS[idx % SERIES_COLORS.length],
      };
    });

    const yTicks = 4;
    const yTickVals = Array.from(
      { length: yTicks + 1 },
      (_, i) => yMin + (i / yTicks) * (yMax - yMin)
    );

    return {
      seriesKeys,
      paths,
      xScale,
      yScale,
      yTickVals,
      minTurn,
      maxTurn,
      innerW,
      innerH,
    };
  }, [history]);

  const metricLabel = METRIC_OPTIONS.find((o) => o.key === metric)?.label ?? metric;
  const hasHistory = history.length > 0;

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-foreground">Equity by sector</h2>
        <p className="text-sm text-muted">
          Figures reflect the selected exchange listing (or the global view). Percent of market cap
          is based on listed corporations in this view.
        </p>

        {sectorRows.length === 0 ? (
          <p className="text-sm text-muted">No listed corporations for this exchange.</p>
        ) : !hasHistory ? (
          <p className="text-sm text-muted">No market history available yet.</p>
        ) : (
          <>
            <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-medium text-foreground">Chart metric (all sectors)</p>
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label="Metric for sector bars"
                >
                  {METRIC_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setMetric(opt.key)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        metric === opt.key
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-card-border bg-card text-muted hover:border-card-border hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted">
                  Bar charts compare companies within each sector for{" "}
                  <span className="font-medium text-foreground">{metricLabel}</span>. Pie shows
                  market cap mix by sector.
                </p>
              </div>

              <div className="flex flex-col items-center gap-4 rounded-xl border border-card-border bg-card p-4 shadow-sm sm:flex-row sm:items-start">
                {pieSlices.length > 0 && (
                  <>
                    <SectorPieChart slices={pieSlices} size={176} />
                    <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-muted sm:max-h-none">
                      {pieSlices.map((s, i) => (
                        <li key={s.label} className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{
                              backgroundColor: SECTOR_PIE_PALETTE[i % SECTOR_PIE_PALETTE.length],
                            }}
                          />
                          <span className="text-foreground">{s.label}</span>
                          <span className="tabular-nums">{s.pct.toFixed(1)}%</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-8 pt-4">
              <h3 className="text-base font-semibold text-foreground">By sector — {metricLabel}</h3>
              {sectorRows.map((row) => {
                const ls = groupedListings.get(row.type) ?? [];
                const sorted = [...ls].sort((a, b) => getMetric(b, metric) - getMetric(a, metric));
                const vals = sorted.map((l) => getMetric(l, metric));
                const wDiv = metric === "dividendRate" ? weightedDividendByMcap(ls) : null;
                return (
                  <div
                    key={row.type}
                    className="rounded-xl border border-card-border bg-card p-4 shadow-sm"
                  >
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="font-semibold text-foreground">{row.label}</h4>
                      {wDiv != null && (
                        <span className="text-xs text-muted">
                          Mcap-weighted avg dividend:{" "}
                          <span className="font-medium tabular-nums text-foreground">
                            {wDiv.toFixed(2)}%
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {sorted.map((l) => {
                        const v = getMetric(l, metric);
                        const w = barWidthPct(vals, v);
                        const corpColor = resolveListingColor(l);
                        return (
                          <div key={l._id} className="flex items-center gap-2 text-xs sm:text-sm">
                            <span className="w-28 shrink-0 truncate sm:w-40" title={l.name}>
                              {l.name}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="h-6 overflow-hidden rounded bg-card-elevated">
                                <div
                                  className="h-full min-w-[3px] rounded transition-all"
                                  style={{
                                    width: `${w}%`,
                                    backgroundColor: corpColor,
                                  }}
                                />
                              </div>
                            </div>
                            <span className="w-24 shrink-0 text-right tabular-nums text-muted">
                              {formatMetricValue(metric, v)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-4 pt-6">
              <h3 className="text-base font-semibold text-foreground">
                Largest companies by sector (by market cap)
              </h3>
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {sectorRows.map((row) => {
                  const top = (groupedListings.get(row.type) ?? []).slice(0, 5);
                  return (
                    <div
                      key={`card-${row.type}`}
                      className="rounded-xl border border-card-border bg-card p-4 shadow-sm"
                    >
                      <h4 className="mb-3 text-sm font-semibold text-foreground">{row.label}</h4>
                      <ul className="space-y-2">
                        {top.map((l, idx) => (
                          <li key={l._id}>
                            <Link
                              href={`/corporation/${l.sequentialId ?? l._id}`}
                              className="flex items-start gap-2 rounded-lg py-1.5 pl-2 transition-colors hover:bg-card-elevated/50"
                              style={{
                                borderLeft: `4px solid ${resolveListingColor(l)}`,
                              }}
                            >
                              <span className="text-[10px] font-mono text-muted tabular-nums">
                                {idx + 1}.
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium text-foreground">{l.name}</div>
                                <div className="text-xs tabular-nums text-muted">
                                  {formatAmount(l.marketCap)}
                                </div>
                              </div>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-card-border pt-6">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card-elevated/50 text-left">
                    <th className="px-4 py-3 font-semibold">Sector</th>
                    <th className="px-4 py-3 font-semibold tabular-nums">
                      Corps
                      <Tooltip content="Listed corporations in this sector on the selected exchange" />
                    </th>
                    <th className="px-4 py-3 font-semibold tabular-nums">
                      Market cap
                      <Tooltip content="Combined market capitalisation of all corporations in this sector" />
                    </th>
                    <th className="px-4 py-3 font-semibold tabular-nums">
                      % of total
                      <Tooltip content="This sector's share of the total exchange market cap" />
                    </th>
                    <th className="px-4 py-3 font-semibold tabular-nums">
                      Daily revenue
                      <Tooltip content="Combined gross revenue across this sector per game day (24 turns)" />
                    </th>
                    <th className="px-4 py-3 font-semibold tabular-nums">
                      Avg ROI %
                      <Tooltip content="Market-cap-weighted average share price change over the last 24 turns" />
                    </th>
                    <th className="px-4 py-3 font-semibold tabular-nums">
                      Avg growth %
                      <Tooltip content="Average projected sector growth rate across corporations in this sector" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sectorRows.map((row) => {
                    const pct = totalMcap > 0 ? (row.marketCap / totalMcap) * 100 : 0;
                    return (
                      <tr key={row.type} className="border-b border-card-border/80 last:border-0">
                        <td className="px-4 py-2.5 font-medium">{row.label}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted">{row.count}</td>
                        <td className="px-4 py-2.5 tabular-nums">{formatAmount(row.marketCap)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-2 max-w-[120px] flex-1 overflow-hidden rounded-full bg-card-elevated">
                              <div
                                className="h-full rounded-full bg-primary/80"
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span className="w-12 text-right tabular-nums text-muted">
                              {pct.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">
                          {formatAmount(row.totalRevenue)}
                        </td>
                        <td
                          className={`px-4 py-2.5 tabular-nums ${
                            row.weightedRoi >= 0 ? "text-success" : "text-error"
                          }`}
                        >
                          {row.weightedRoi >= 0 ? "+" : ""}
                          {row.weightedRoi.toFixed(2)}%
                        </td>
                        <td
                          className={`px-4 py-2.5 tabular-nums ${
                            row.avgGrowth > 0 ? "text-success" : "text-muted"
                          }`}
                        >
                          {row.avgGrowth.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-foreground">
          Historical market cap by sector (global)
        </h2>
        <p className="text-sm text-muted">
          Combined capitalization across all exchanges by corporate sector, one snapshot per turn.
          Compare to the exchange index chart above for the selected market.
        </p>
        {multiSeries ? (
          <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
            <svg
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              className="h-auto w-full"
              style={{ maxHeight: CHART_H }}
            >
              {multiSeries.paths.map((p) => (
                <path
                  key={p.key}
                  d={p.d}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {multiSeries.yTickVals.map((yv, i) => (
                <line
                  key={i}
                  x1={PAD.left}
                  x2={PAD.left + multiSeries.innerW}
                  y1={multiSeries.yScale(yv)}
                  y2={multiSeries.yScale(yv)}
                  stroke="var(--card-border)"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
              ))}
              {multiSeries.yTickVals.map((yv, i) => (
                <text
                  key={`yl-${i}`}
                  x={PAD.left - 10}
                  y={multiSeries.yScale(yv) + 4}
                  textAnchor="end"
                  fontSize="10"
                  fontWeight="500"
                  fill="var(--muted)"
                >
                  {formatAmount(yv)}
                </text>
              ))}
              {(() => {
                const turnRange = multiSeries.maxTurn - multiSeries.minTurn;
                const step = Math.max(1, Math.floor(turnRange / 6));
                const labels: number[] = [];
                for (let t = multiSeries.minTurn; t <= multiSeries.maxTurn; t += step)
                  labels.push(t);
                if (labels[labels.length - 1] !== multiSeries.maxTurn)
                  labels.push(multiSeries.maxTurn);
                return labels.map((t) => (
                  <text
                    key={t}
                    x={multiSeries.xScale(t)}
                    y={PAD.top + multiSeries.innerH + 22}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="500"
                    fill="var(--muted)"
                  >
                    T{t}
                  </text>
                ));
              })()}
            </svg>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
              {multiSeries.seriesKeys.map(({ key, label }, idx) => (
                <div key={String(key)} className="flex items-center gap-2 text-xs text-muted">
                  <span
                    className="inline-block h-2 w-3 rounded-sm"
                    style={{ background: SERIES_COLORS[idx % SERIES_COLORS.length] }}
                  />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Not enough history yet to chart sector trends (need at least two turns with sector
            snapshots).
          </p>
        )}
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-foreground">Bonds snapshot</h2>
          <div className="space-y-2 rounded-xl border border-card-border bg-card p-4 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted">Corporate issues</span>
              <span className="font-semibold tabular-nums">{bondSnapshot.corporate}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted">Sovereign issues</span>
              <span className="font-semibold tabular-nums">{bondSnapshot.sovereign}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted">In default</span>
              <span className="font-semibold tabular-nums text-error">
                {bondSnapshot.defaulted}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted">Total public float (units)</span>
              <span className="font-semibold tabular-nums">
                {bondSnapshot.totalFloat.toLocaleString("en-US")}
              </span>
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <h2 className="text-lg font-bold text-foreground">Commodities snapshot</h2>
          {commodities.length === 0 ? (
            <p className="text-sm text-muted">No commodity data loaded.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full min-w-[400px] text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card-elevated/50 text-left">
                    <th className="px-3 py-2 font-semibold">Commodity</th>
                    <th className="px-3 py-2 font-semibold tabular-nums">
                      Price
                      <Tooltip content="Current world market price per unit" />
                    </th>
                    <th className="px-3 py-2 font-semibold tabular-nums">
                      Recent Δ
                      <Tooltip content="Price change over the last few turns" />
                    </th>
                    <th className="px-3 py-2 font-semibold tabular-nums">
                      Annual Δ
                      <Tooltip content="Price change over the last 48 turns (one in-game year)" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {commodities.map((c) => (
                    <tr key={c.commodity} className="border-b border-card-border/80 last:border-0">
                      <td className="px-3 py-2">{c.label}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">
                        {formatPrice(c.globalPrice)}
                        <span className="ml-1 text-[10px] font-sans font-normal text-muted">
                          /{c.unit}
                        </span>
                      </td>
                      <td
                        className={`px-3 py-2 tabular-nums ${
                          (c.recentPriceChange ?? c.priceChange ?? 0) >= 0
                            ? "text-success"
                            : "text-error"
                        }`}
                      >
                        {(c.recentPriceChange ?? c.priceChange ?? 0) >= 0 ? "+" : ""}
                        {(c.recentPriceChange ?? c.priceChange ?? 0).toFixed(2)}%
                      </td>
                      <td
                        className={`px-3 py-2 tabular-nums ${
                          (c.annualPriceChange ?? c.priceChange ?? 0) >= 0
                            ? "text-success"
                            : "text-error"
                        }`}
                      >
                        {`${(c.annualPriceChange ?? c.priceChange ?? 0) >= 0 ? "+" : ""}${(c.annualPriceChange ?? c.priceChange ?? 0).toFixed(2)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
