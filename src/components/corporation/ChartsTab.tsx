"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CorpHistoryPoint } from "./CorporationPageTypes";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useFeatureSeen } from "@/hooks/useFeatureSeen";
import { CORP_PAGE_FEATURE_KEYS } from "@/lib/ui/corpPageFeatureKeys";
import { MarketSharePanel } from "./MarketSharePanel";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { DenseSection, TableScroll, Td, Th, signTone } from "./dense/DenseKit";
import { DenseLineChart, type LineSeries } from "./dense/DenseLineChart";

type ChartMetric =
  | "marketCap"
  | "sharePrice"
  | "revenueCosts"
  | "cashOnHand"
  | "marketingStrength"
  | "dividendRate"
  | "corporateTax"
  | "brandLoyalty"
  | "averageQuality"
  | "marketShare";

const CHART_METRICS: { key: ChartMetric; label: string; description: string }[] = [
  { key: "sharePrice", label: "Share price", description: "Stock price over time." },
  { key: "marketCap", label: "Market cap", description: "Total market capitalization." },
  {
    key: "revenueCosts",
    label: "Revenue and costs",
    description:
      "Per-turn operating revenue vs operating costs. Financial Statement values are daily totals (24 turns), so multiply chart points by 24 when comparing.",
  },
  { key: "cashOnHand", label: "Cash on hand", description: "Liquid capital reserves." },
  { key: "marketingStrength", label: "Marketing", description: "Marketing strength over time." },
  { key: "dividendRate", label: "Dividend rate", description: "Dividend payout rate." },
  {
    key: "corporateTax",
    label: "Corporate tax",
    description:
      "Domestic vs foreign corporate tax paid per turn (federal and state combined). Pre-migration snapshots fall back to the combined total. Zero on unprofitable turns.",
  },
  {
    key: "brandLoyalty",
    label: "Brand loyalty",
    description:
      "Your corporation's brand loyalty reputation over time, earned by pricing consistently and delivering.",
  },
  {
    key: "averageQuality",
    label: "Average quality",
    description: "Average product quality across your corporation's sectors over time.",
  },
  {
    key: "marketShare",
    label: "Market share",
    description:
      "Your share of global commodity output over time, by physical units produced per commodity, with stockpile history.",
  },
];

/** Sum all numeric values in a Record<string, number> (treating missing as 0). */
function sumRecord(rec: Record<string, number> | undefined): number {
  if (!rec) return 0;
  let total = 0;
  for (const v of Object.values(rec)) total += v;
  return total;
}

interface MetricSeries {
  values: number[];
  values2?: number[];
  label: string;
  label2?: string;
  format: (v: number) => string;
  /** Change column: percent change, or percentage points for a rate. */
  changeIn: "pct" | "pp";
}

export default function ChartsTab({
  corpId,
  modViewEnabled = false,
  ownerView = false,
}: {
  corpId: string;
  modViewEnabled?: boolean;
  /** CEO/owner or mod view: gates the owner-only Brand Loyalty chart. */
  ownerView?: boolean;
}) {
  const { formatAmount, formatPrice: fmtPrice, toInternalFrom } = useCurrency();
  const [history, setHistory] = useState<CorpHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMetric, setActiveMetric] = useState<ChartMetric>("sharePrice");
  const marketShareDiscovery = useFeatureSeen(CORP_PAGE_FEATURE_KEYS.marketShareChart);

  // Brand Loyalty is an owner/CEO + mod-only chart (reputation intel). Avg Quality
  // is aggregate/non-sensitive and stays visible to everyone.
  const visibleMetrics = ownerView
    ? CHART_METRICS
    : CHART_METRICS.filter((m) => m.key !== "brandLoyalty");

  const selectMetric = (metric: ChartMetric) => {
    if (metric === "marketShare") {
      marketShareDiscovery.markSeen();
    }
    setActiveMetric(metric);
  };

  useEffect(() => {
    async function fetchHistory() {
      try {
        // `full=1` returns the entire history back to game start, downsampled
        // to a bounded number of points (the recent-500 default is for the
        // masthead sparkline, not this long-range chart).
        const historyUrl = modViewEnabled
          ? `/api/corporations/${corpId}/history?full=1&modView=1`
          : `/api/corporations/${corpId}/history?full=1`;
        const res = await fetch(historyUrl);
        if (res.ok) {
          const data = await res.json();
          setHistory(data.history ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, [corpId, modViewEnabled]);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  // Post-v0.2.6: money fields in each history snapshot are stored in that
  // snapshot's own `currencyCode` (Task 10). Normalize every plotted value
  // to ₳ so a shared Y-axis works across legacy (no code) and post-migration
  // (code stamped) snapshots. Formatting then honors wallet preference via
  // the representative currency for the selected metric.
  //
  // Use the rate that was ACTUALLY in effect when this row was written
  // (`fxRateAtWrite`), not the live/current rate. FX floats every turn, so
  // reconverting an old snapshot with today's rate drifts by however much
  // that currency has moved since (#2958). Rows written before this field
  // existed fall back to the live rate (best available, matches prior
  // behavior for that legacy data).
  const toAnchor = (val: number, code?: string, fxRateAtWrite?: number) => {
    if (!code) return val;
    if (typeof fxRateAtWrite === "number" && fxRateAtWrite > 0) return val / fxRateAtWrite;
    return toInternalFrom(val, code as CurrencyCode);
  };
  const latestPoint = history[history.length - 1];
  const representativeCode = (metric: ChartMetric) =>
    (metric === "marketCap" && latestPoint?.marketCapCurrencyCode !== undefined
      ? (latestPoint.marketCapCurrencyCode ?? undefined)
      : latestPoint?.currencyCode) as CurrencyCode | undefined;

  // Extract the data series for one metric.
  function seriesFor(metric: Exclude<ChartMetric, "marketShare">): MetricSeries {
    const code = representativeCode(metric);
    const fmtMoney = (v: number) => formatAmount(v, code);
    switch (metric) {
      case "sharePrice":
        return {
          values: history.map((p) => toAnchor(p.sharePrice, p.currencyCode, p.fxRateAtWrite)),
          label: "Share price",
          format: (v) => fmtPrice(v, code),
          changeIn: "pct",
        };
      case "marketCap":
        return {
          values: history.map((p) =>
            p.marketCapCurrencyCode !== undefined
              ? toAnchor(p.marketCap, p.marketCapCurrencyCode ?? undefined)
              : toAnchor(p.marketCap, p.currencyCode, p.fxRateAtWrite)
          ),
          label: "Market cap",
          format: fmtMoney,
          changeIn: "pct",
        };
      case "revenueCosts":
        return {
          values: history.map((p) => toAnchor(p.revenue, p.currencyCode, p.fxRateAtWrite)),
          values2: history.map((p) => toAnchor(p.totalCosts, p.currencyCode, p.fxRateAtWrite)),
          label: "Revenue / turn",
          label2: "Costs / turn",
          format: fmtMoney,
          changeIn: "pct",
        };
      case "cashOnHand":
        return {
          values: history.map((p) => toAnchor(p.liquidCapital, p.currencyCode, p.fxRateAtWrite)),
          label: "Cash on hand",
          format: fmtMoney,
          changeIn: "pct",
        };
      case "marketingStrength":
        return {
          values: history.map((p) => p.marketingStrength),
          label: "Marketing strength",
          format: (v) => v.toFixed(1),
          changeIn: "pct",
        };
      case "brandLoyalty":
        return {
          values: history.map((p) => p.brandLoyalty ?? 0),
          label: "Brand loyalty",
          format: (v) => v.toFixed(1),
          changeIn: "pct",
        };
      case "averageQuality":
        return {
          values: history.map((p) => p.averageQuality ?? 0),
          label: "Average quality",
          format: (v) => v.toFixed(1),
          changeIn: "pct",
        };
      case "dividendRate":
        return {
          values: history.map((p) => p.dividendRate),
          label: "Dividend rate",
          format: (v) => `${v.toFixed(1)}%`,
          changeIn: "pp",
        };
      case "corporateTax":
        return {
          // Split domestic vs foreign when the per-turn split maps are populated (post-migration).
          // Falls back to federal+state combined for pre-migration rows so the chart remains
          // continuous across the cutover. Each side collapses fed+state into one series.
          values: history.map((p) => {
            const domestic =
              sumRecord(p.taxPaidByCountryDomestic) + sumRecord(p.taxPaidByStateDomestic);
            if (domestic > 0) return toAnchor(domestic, p.currencyCode, p.fxRateAtWrite);
            // Pre-migration fallback: the domestic series carries the combined total.
            return toAnchor(
              (p.federalTaxPaid ?? 0) + (p.stateTaxPaid ?? 0),
              p.currencyCode,
              p.fxRateAtWrite
            );
          }),
          values2: history.map((p) => {
            const foreign =
              sumRecord(p.taxPaidByCountryForeign) + sumRecord(p.taxPaidByStateForeign);
            return foreign > 0 ? toAnchor(foreign, p.currencyCode, p.fxRateAtWrite) : 0;
          }),
          label: "Domestic",
          label2: "Foreign",
          format: fmtMoney,
          changeIn: "pct",
        };
    }
  }

  const hasHistory = history.length >= 2;

  const changeText = (s: MetricSeries): { text: string; value: number | null } => {
    const first = s.values[0];
    const last = s.values[s.values.length - 1];
    if (s.changeIn === "pp") {
      const d = last - first;
      return { text: `${d > 0 ? "+" : ""}${d.toFixed(1)} pp`, value: d };
    }
    if (first === 0) return { text: "", value: null };
    const pct = ((last - first) / Math.abs(first)) * 100;
    return { text: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`, value: pct };
  };

  const metricTable = (
    <DenseSection
      title="Metrics"
      meta={hasHistory ? `T${history[0].turn} to T${latestPoint.turn}` : undefined}
    >
      <TableScroll>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Metric</Th>
              <Th align="right">Latest</Th>
              <Th align="right" title="Change over the charted history">
                Change
              </Th>
            </tr>
          </thead>
          <tbody>
            {visibleMetrics.map((m) => {
              const selected = m.key === activeMetric;
              const s = m.key !== "marketShare" && hasHistory ? seriesFor(m.key) : null;
              const change = s ? changeText(s) : null;
              return (
                <tr key={m.key} className={selected ? "bg-card-elevated" : undefined}>
                  <Td numeric={false}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectMetric(m.key)}
                      className={`text-left hover:underline ${
                        selected ? "font-semibold text-foreground" : "text-foreground"
                      }`}
                    >
                      {m.label}
                    </button>
                    {m.key === "marketShare" && marketShareDiscovery.isNew && (
                      <span className="ml-1.5 text-[10px] font-medium text-primary">new</span>
                    )}
                  </Td>
                  <Td align="right">
                    {m.key === "marketShare" ? (
                      <span className="font-sans text-xs text-muted">by commodity</span>
                    ) : s ? (
                      s.format(s.values[s.values.length - 1])
                    ) : (
                      ""
                    )}
                  </Td>
                  <Td align="right" className={signTone(change?.value)}>
                    {change?.text ?? ""}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </DenseSection>
  );

  const metricConfig = CHART_METRICS.find((m) => m.key === activeMetric)!;

  let chartPanel: ReactNode;
  if (activeMetric === "marketShare") {
    chartPanel = <MarketSharePanel corpId={corpId} modViewEnabled={modViewEnabled} />;
  } else if (!hasHistory) {
    chartPanel = (
      <DenseSection title={metricConfig.label}>
        <p className="py-2 text-xs text-muted">
          Not enough historical data yet. Time-series charts will appear after a few turns of
          activity. Market share is available now.
        </p>
      </DenseSection>
    );
  } else {
    const series = seriesFor(activeMetric);
    const fmtMoney = (v: number) => formatAmount(v, representativeCode(activeMetric));
    const lines: LineSeries[] = [
      { label: series.label, values: series.values, tone: "text-foreground" },
    ];
    if (series.values2 && series.label2) {
      lines.push({
        label: series.label2,
        values: series.values2,
        tone: "text-muted",
        dashed: true,
      });
    }
    const high = Math.max(...series.values);
    const low = Math.min(...series.values);
    const periodTurns = latestPoint.turn - history[0].turn + 1;

    const tooltip = (i: number) => {
      const point = history[i];
      const currencyCode = point.currencyCode as CurrencyCode | undefined;
      const fx = point.fxRateAtWrite;
      const rows: { label: string; value: string }[] = [];
      if (activeMetric === "revenueCosts") {
        rows.push({
          label: "Operating income",
          value: fmtMoney(toAnchor(point.revenue - point.totalCosts, currencyCode, fx)),
        });
        const tax = toAnchor(point.corporateTaxPaid ?? 0, currencyCode, fx);
        if (tax !== 0) rows.push({ label: "Taxes", value: fmtMoney(tax) });
        const coupons = toAnchor(point.perTurnBondCouponIncome ?? 0, currencyCode, fx);
        if (coupons !== 0) rows.push({ label: "Bond coupons", value: fmtMoney(coupons) });
        const drag = toAnchor(point.perTurnBondDragOnNetIncome ?? 0, currencyCode, fx);
        if (drag !== 0) rows.push({ label: "Bond interest", value: fmtMoney(drag) });
        if (point.incomePreDividends != null) {
          rows.push({
            label: "Net income",
            value: fmtMoney(
              toAnchor(
                point.incomePreDividends -
                  (point.corporateTaxPaid ?? 0) +
                  (point.perTurnBondCouponIncome ?? 0) -
                  (point.perTurnBondDragOnNetIncome ?? 0),
                currencyCode,
                fx
              )
            ),
          });
        }
        const dividends = toAnchor(point.dividendPaidPerTurn ?? 0, currencyCode, fx);
        if (dividends !== 0) {
          rows.push({ label: "Dividends", value: fmtMoney(dividends) });
          rows.push({
            label: "Retained after dividends",
            value: fmtMoney(toAnchor(point.income, currencyCode, fx)),
          });
        }
        const md = point.marginDiagnostic;
        if (md) {
          rows.push(
            { label: "Margin", value: `${md.effectiveMargin.toFixed(1)}%` },
            { label: "Commodity", value: `${md.commodityInputMod.toFixed(1)}pp` },
            { label: "Surplus", value: `${md.commoditySurplusMod.toFixed(1)}pp` },
            { label: "Export", value: `${(md.exportPremiumMod ?? 0).toFixed(1)}pp` },
            { label: "Macro", value: `${md.macroMod.toFixed(1)}pp` },
            { label: "State", value: `${md.stateMetricsMod.toFixed(1)}pp` },
            { label: "Growth cost", value: `${(md.growthCostRatio * 100).toFixed(2)}%` },
            { label: "Sectors", value: String(md.sectorCount) }
          );
        }
      }
      return (
        <table className="border-collapse">
          <tbody>
            {lines.map((l) => (
              <tr key={l.label}>
                <td className={`pr-3 ${l.tone}`}>{l.label}</td>
                <td className="text-right font-mono tabular-nums text-foreground">
                  {series.format(l.values[i])}
                </td>
              </tr>
            ))}
            {rows.map((r) => (
              <tr key={r.label} className="text-muted">
                <td className="pr-3">{r.label}</td>
                <td className="text-right font-mono tabular-nums">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    };

    chartPanel = (
      <DenseSection title={metricConfig.label} meta={`${periodTurns} turns`}>
        <p className="py-1 text-xs text-muted">{metricConfig.description}</p>
        <DenseLineChart
          turns={history.map((p) => p.turn)}
          series={lines}
          formatTick={series.format}
          ariaLabel={`${metricConfig.label} by turn`}
          tooltip={tooltip}
        />
        <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-card-border pt-1.5 text-xs">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted">High</dt>
            <dd className="font-mono tabular-nums text-foreground">{series.format(high)}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted">Low</dt>
            <dd className="font-mono tabular-nums text-foreground">{series.format(low)}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted">Points</dt>
            <dd className="font-mono tabular-nums text-foreground">{history.length}</dd>
          </div>
        </dl>
      </DenseSection>
    );
  }

  return (
    <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="min-w-0">{metricTable}</div>
      <div className="min-w-0">{chartPanel}</div>
    </div>
  );
}
