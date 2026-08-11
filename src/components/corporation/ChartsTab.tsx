"use client";

import { useEffect, useState } from "react";
import { CorpHistoryPoint } from "./CorporationPageTypes";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useFeatureSeen } from "@/hooks/useFeatureSeen";
import { CORP_PAGE_FEATURE_KEYS } from "@/lib/ui/corpPageFeatureKeys";
import { ChartMetricPills } from "./ChartMetricPills";
import { MarketSharePanel } from "./MarketSharePanel";
import type { CurrencyCode } from "@/lib/constants/currencies";

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

const CHART_METRICS: { key: ChartMetric; label: string; color: string; description: string }[] = [
  {
    key: "sharePrice",
    label: "Share Price",
    color: "#3b82f6",
    description: "Stock price over time",
  },
  {
    key: "marketCap",
    label: "Market Cap",
    color: "#8b5cf6",
    description: "Total market capitalization",
  },
  {
    key: "revenueCosts",
    label: "Revenue & Costs",
    color: "#22c55e",
    description:
      "Per-turn operating revenue vs operating costs. Financial Statement values are daily totals (24 turns), so multiply chart points by 24 when comparing.",
  },
  {
    key: "cashOnHand",
    label: "Cash on Hand",
    color: "#f59e0b",
    description: "Liquid capital reserves",
  },
  {
    key: "marketingStrength",
    label: "Marketing",
    color: "#ec4899",
    description: "Marketing strength over time",
  },
  {
    key: "dividendRate",
    label: "Dividend Yield",
    color: "#14b8a6",
    description: "Dividend payout rate",
  },
  {
    key: "corporateTax",
    label: "Corporate Tax",
    color: "#ef4444",
    description:
      "Domestic vs foreign corporate tax paid per turn (federal + state combined). Pre-migration snapshots fall back to the combined total. Zero on unprofitable turns.",
  },
  {
    key: "brandLoyalty",
    label: "Brand Loyalty",
    color: "#d97706",
    description:
      "Your corporation's brand loyalty reputation over time, earned by pricing consistently and delivering.",
  },
  {
    key: "averageQuality",
    label: "Avg Quality",
    color: "#0d9488",
    description: "Average product quality across your corporation's sectors over time.",
  },
  {
    key: "marketShare",
    label: "Market Share",
    color: "#06b6d4",
    description:
      "Your share of global commodity output over time — by physical units produced per commodity, with stockpile history.",
  },
];

/** Sum all numeric values in a Record<string, number> (treating missing as 0). */
function sumRecord(rec: Record<string, number> | undefined): number {
  if (!rec) return 0;
  let total = 0;
  for (const v of Object.values(rec)) total += v;
  return total;
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 200;
const C_PAD_LEFT = 56;
const C_PAD_RIGHT = 16;
const C_PAD_TOP = 16;
const C_PAD_BOTTOM = 32;
const C_INNER_W = CHART_WIDTH - C_PAD_LEFT - C_PAD_RIGHT;
const C_INNER_H = CHART_HEIGHT - C_PAD_TOP - C_PAD_BOTTOM;

export default function ChartsTab({
  corpId,
  brandColor,
  modViewEnabled = false,
  ownerView = false,
}: {
  corpId: string;
  brandColor?: string;
  modViewEnabled?: boolean;
  /** CEO/owner or mod view — gates the owner-only Brand Loyalty chart. */
  ownerView?: boolean;
}) {
  const { formatAmount, formatPrice: fmtPrice, toInternalFrom } = useCurrency();
  const [history, setHistory] = useState<CorpHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMetric, setActiveMetric] = useState<ChartMetric>("sharePrice");
  const [hovered, setHovered] = useState<number | null>(null);
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
    setHovered(null);
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
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (activeMetric === "marketShare") {
    return (
      <div className="space-y-4">
        <ChartMetricPills
          metrics={visibleMetrics}
          activeMetric={activeMetric}
          onSelect={(key) => selectMetric(key as ChartMetric)}
          brandColor={brandColor}
          newBadgeKey="marketShare"
          newBadgeVisible={marketShareDiscovery.isNew}
        />
        <MarketSharePanel corpId={corpId} brandColor={brandColor} modViewEnabled={modViewEnabled} />
      </div>
    );
  }

  if (history.length < 2) {
    return (
      <div className="space-y-4">
        <ChartMetricPills
          metrics={visibleMetrics}
          activeMetric={activeMetric}
          onSelect={(key) => selectMetric(key as ChartMetric)}
          brandColor={brandColor}
          newBadgeKey="marketShare"
          newBadgeVisible={marketShareDiscovery.isNew}
        />
        <div className="rounded-xl border border-card-border bg-card p-8 text-center">
          <div className="text-muted text-sm">
            Not enough historical data yet. Time-series charts will appear after a few turns of
            activity. Market Share is available now.
          </div>
        </div>
      </div>
    );
  }

  const metricConfig = CHART_METRICS.find((m) => m.key === activeMetric)!;
  const accentColor = brandColor || metricConfig.color;

  // Post-v0.2.6: money fields in each history snapshot are stored in that
  // snapshot's own `currencyCode` (Task 10). Normalize every plotted value
  // to ₳ so a shared Y-axis works across legacy (no code) and post-migration
  // (code stamped) snapshots. Formatting then honors wallet preference via
  // the representative currency (latest snapshot's code = corp's current).
  //
  // Use the rate that was ACTUALLY in effect when this row was written
  // (`fxRateAtWrite`), not the live/current rate — FX floats every turn, so
  // reconverting an old snapshot with today's rate drifts by however much
  // that currency has moved since (#2958). Rows written before this field
  // existed fall back to the live rate (best available, matches prior
  // behavior for that legacy data).
  const toAnchor = (val: number, code?: string, fxRateAtWrite?: number) => {
    if (!code) return val;
    if (typeof fxRateAtWrite === "number" && fxRateAtWrite > 0) return val / fxRateAtWrite;
    return toInternalFrom(val, code as CurrencyCode);
  };
  const representativeCode = history[history.length - 1]?.currencyCode as CurrencyCode | undefined;
  const fmtMoney = (v: number) => formatAmount(v, representativeCode);
  const fmtSharePrice = (v: number) => fmtPrice(v, representativeCode);

  // Extract data series based on active metric
  function getSeriesData(): {
    values: number[];
    values2?: number[];
    label: string;
    label2?: string;
    format: (v: number) => string;
    isCurrency: boolean;
  } {
    switch (activeMetric) {
      case "sharePrice":
        return {
          values: history.map((p) => toAnchor(p.sharePrice, p.currencyCode, p.fxRateAtWrite)),
          label: "Share Price",
          format: fmtSharePrice,
          isCurrency: true,
        };
      case "marketCap":
        return {
          values: history.map((p) => toAnchor(p.marketCap, p.currencyCode, p.fxRateAtWrite)),
          label: "Market Cap",
          format: fmtMoney,
          isCurrency: true,
        };
      case "revenueCosts":
        return {
          values: history.map((p) => toAnchor(p.revenue, p.currencyCode, p.fxRateAtWrite)),
          values2: history.map((p) => toAnchor(p.totalCosts, p.currencyCode, p.fxRateAtWrite)),
          label: "Revenue / turn",
          label2: "Costs / turn",
          format: fmtMoney,
          isCurrency: true,
        };
      case "cashOnHand":
        return {
          values: history.map((p) => toAnchor(p.liquidCapital, p.currencyCode, p.fxRateAtWrite)),
          label: "Cash on Hand",
          format: fmtMoney,
          isCurrency: true,
        };
      case "marketingStrength":
        return {
          values: history.map((p) => p.marketingStrength),
          label: "Marketing Strength",
          format: (v) => v.toFixed(1),
          isCurrency: false,
        };
      case "brandLoyalty":
        return {
          values: history.map((p) => p.brandLoyalty ?? 0),
          label: "Brand Loyalty",
          format: (v) => v.toFixed(1),
          isCurrency: false,
        };
      case "averageQuality":
        return {
          values: history.map((p) => p.averageQuality ?? 0),
          label: "Avg Quality",
          format: (v) => v.toFixed(1),
          isCurrency: false,
        };
      case "dividendRate":
        return {
          values: history.map((p) => p.dividendRate),
          label: "Dividend Rate",
          format: (v) => `${v.toFixed(1)}%`,
          isCurrency: false,
        };
      case "corporateTax":
        return {
          // Split domestic vs foreign when the per-turn split maps are populated (post-migration).
          // Falls back to federal+state combined for pre-migration rows so the chart remains
          // continuous across the cutover. Each side collapses fed+state into one series so
          // the existing 2-series renderer can stay as-is.
          values: history.map((p) => {
            const domestic =
              sumRecord(p.taxPaidByCountryDomestic) + sumRecord(p.taxPaidByStateDomestic);
            if (domestic > 0) return toAnchor(domestic, p.currencyCode, p.fxRateAtWrite);
            // Pre-migration fallback — domestic series carries the combined total.
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
          isCurrency: true,
        };
      case "marketShare":
        throw new Error("marketShare is rendered outside the time-series chart");
    }
  }

  const series = getSeriesData();
  const allVals = [...series.values, ...(series.values2 ?? [])];
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const range = maxVal - minVal || 1;
  // Add 10% padding
  const yMin = minVal - range * 0.05;
  const yMax = maxVal + range * 0.05;
  const yRange = yMax - yMin || 1;

  function toX(i: number): number {
    if (history.length <= 1) return C_PAD_LEFT + C_INNER_W / 2;
    return C_PAD_LEFT + (i / (history.length - 1)) * C_INNER_W;
  }

  function toY(value: number): number {
    return C_PAD_TOP + ((yMax - value) / yRange) * C_INNER_H;
  }

  const points = series.values.map((v, i) => ({ x: toX(i), y: toY(v), value: v }));
  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  let points2: typeof points | undefined;
  let polyline2: string | undefined;
  if (series.values2) {
    points2 = series.values2.map((v, i) => ({ x: toX(i), y: toY(v), value: v }));
    polyline2 = points2.map((p) => `${p.x},${p.y}`).join(" ");
  }

  // Y-axis labels (5 evenly spaced)
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (yRange * i) / 4);

  // X-axis labels
  const xLabelIndices: number[] = [];
  if (history.length <= 5) {
    history.forEach((_, i) => xLabelIndices.push(i));
  } else {
    const step = Math.floor((history.length - 1) / 4);
    for (let i = 0; i <= 4; i++) {
      xLabelIndices.push(Math.min(i * step, history.length - 1));
    }
    if (!xLabelIndices.includes(history.length - 1)) {
      xLabelIndices[xLabelIndices.length - 1] = history.length - 1;
    }
  }

  const hoveredPoint = hovered !== null ? points[hovered] : null;
  const hoveredPoint2 = hovered !== null && points2 ? points2[hovered] : null;
  const hoveredHistoryPoint = hovered !== null ? history[hovered] : null;
  const revenueCostsTooltip =
    activeMetric === "revenueCosts" && hoveredHistoryPoint
      ? (() => {
          const point = hoveredHistoryPoint;
          const currencyCode = point.currencyCode as CurrencyCode | undefined;
          const fxRateAtWrite = point.fxRateAtWrite;
          const operatingIncome = toAnchor(
            point.revenue - point.totalCosts,
            currencyCode,
            fxRateAtWrite
          );
          const corporateTaxPaid = toAnchor(
            point.corporateTaxPaid ?? 0,
            currencyCode,
            fxRateAtWrite
          );
          const bondCouponIncome = toAnchor(
            point.perTurnBondCouponIncome ?? 0,
            currencyCode,
            fxRateAtWrite
          );
          const bondInterestDrag = toAnchor(
            point.perTurnBondDragOnNetIncome ?? 0,
            currencyCode,
            fxRateAtWrite
          );
          const dividendPaid = toAnchor(
            point.dividendPaidPerTurn ?? 0,
            currencyCode,
            fxRateAtWrite
          );
          const netIncomeBeforeDividends =
            point.incomePreDividends != null
              ? toAnchor(
                  point.incomePreDividends -
                    (point.corporateTaxPaid ?? 0) +
                    (point.perTurnBondCouponIncome ?? 0) -
                    (point.perTurnBondDragOnNetIncome ?? 0),
                  currencyCode,
                  fxRateAtWrite
                )
              : null;
          const retainedAfterDividends = toAnchor(point.income, currencyCode, fxRateAtWrite);

          return {
            operatingIncome,
            corporateTaxPaid,
            bondCouponIncome,
            bondInterestDrag,
            dividendPaid,
            netIncomeBeforeDividends,
            retainedAfterDividends,
          };
        })()
      : null;

  // Color for secondary line in revenue/costs chart
  const secondaryColor = "#ef4444";

  // Header + summary-card stats (primary series).
  const lastVal = series.values[series.values.length - 1];
  const firstVal = series.values[0];
  const highVal = Math.max(...series.values);
  const lowVal = Math.min(...series.values);
  const changePct = firstVal !== 0 ? ((lastVal - firstVal) / Math.abs(firstVal)) * 100 : 0;
  const periodTurns = history[history.length - 1].turn - history[0].turn + 1;

  return (
    <div className="space-y-4">
      {/* Metric selector — pill/chip toggle with per-metric colored dots */}
      <ChartMetricPills
        metrics={visibleMetrics}
        activeMetric={activeMetric}
        onSelect={(key) => selectMetric(key as ChartMetric)}
        brandColor={brandColor}
        newBadgeKey="marketShare"
        newBadgeVisible={marketShareDiscovery.isNew}
      />

      {/* Chart */}
      <div className="rounded-xl border border-card-border bg-card p-4">
        {/* Header — metric title + description (left), current value (right) */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{metricConfig.label}</h3>
            <p className="mt-0.5 max-w-md text-xs text-muted">{metricConfig.description}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
              Current
            </div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: accentColor }}>
              {series.format(lastVal)}
            </div>
          </div>
        </div>

        <div className="relative select-none">
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            className="w-full"
            style={{ height: CHART_HEIGHT }}
            onMouseLeave={() => setHovered(null)}
          >
            {/* Grid lines */}
            {yTicks.map((tick, i) => {
              const y = toY(tick);
              return (
                <g key={i}>
                  <line
                    x1={C_PAD_LEFT}
                    y1={y}
                    x2={CHART_WIDTH - C_PAD_RIGHT}
                    y2={y}
                    stroke="currentColor"
                    strokeWidth={1}
                    className="text-card-border/40"
                    strokeDasharray={i === 0 || i === 4 ? undefined : "3 3"}
                  />
                  <text
                    x={C_PAD_LEFT - 6}
                    y={y + 4}
                    textAnchor="end"
                    fontSize={9}
                    className="fill-muted/70"
                  >
                    {series.isCurrency
                      ? activeMetric === "sharePrice"
                        ? fmtSharePrice(tick)
                        : fmtMoney(tick)
                      : tick.toFixed(tick < 10 ? 1 : 0)}
                    {!series.isCurrency && activeMetric === "dividendRate" ? "%" : ""}
                  </text>
                </g>
              );
            })}

            {/* Area fill under primary line */}
            <defs>
              <linearGradient id={`chartGrad-${activeMetric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accentColor} stopOpacity={0.2} />
                <stop offset="100%" stopColor={accentColor} stopOpacity={0} />
              </linearGradient>
              {series.values2 && (
                <linearGradient id={`chartGrad2-${activeMetric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={secondaryColor} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={secondaryColor} stopOpacity={0} />
                </linearGradient>
              )}
            </defs>
            <polygon
              points={`${points[0].x},${C_PAD_TOP + C_INNER_H} ${polyline} ${points[points.length - 1].x},${C_PAD_TOP + C_INNER_H}`}
              fill={`url(#chartGrad-${activeMetric})`}
            />

            {/* Secondary area fill */}
            {polyline2 && points2 && (
              <polygon
                points={`${points2[0].x},${C_PAD_TOP + C_INNER_H} ${polyline2} ${points2[points2.length - 1].x},${C_PAD_TOP + C_INNER_H}`}
                fill={`url(#chartGrad2-${activeMetric})`}
              />
            )}

            {/* Secondary line */}
            {polyline2 && (
              <polyline
                points={polyline2}
                fill="none"
                stroke={secondaryColor}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.8}
              />
            )}

            {/* Primary line */}
            <polyline
              points={polyline}
              fill="none"
              stroke={accentColor}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Hover hit targets */}
            {points.map((p, i) => {
              const prevX = i > 0 ? points[i - 1].x : p.x;
              const nextX = i < points.length - 1 ? points[i + 1].x : p.x;
              const hitX = (prevX + p.x) / 2;
              const hitW = (nextX + p.x) / 2 - hitX;
              return (
                <rect
                  key={i}
                  x={hitX}
                  y={C_PAD_TOP}
                  width={Math.max(hitW, 8)}
                  height={C_INNER_H}
                  fill="transparent"
                  onMouseEnter={() => setHovered(i)}
                />
              );
            })}

            {/* Hover crosshair + dot */}
            {hoveredPoint && (
              <>
                <line
                  x1={hoveredPoint.x}
                  y1={C_PAD_TOP}
                  x2={hoveredPoint.x}
                  y2={C_PAD_TOP + C_INNER_H}
                  stroke={accentColor}
                  strokeWidth={1}
                  strokeDasharray="3 2"
                  opacity={0.6}
                />
                <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={4} fill={accentColor} />
                {hoveredPoint2 && (
                  <circle cx={hoveredPoint2.x} cy={hoveredPoint2.y} r={4} fill={secondaryColor} />
                )}
              </>
            )}

            {/* X-axis turn labels */}
            {xLabelIndices.map((i) => (
              <text
                key={i}
                x={points[i].x}
                y={CHART_HEIGHT - 6}
                textAnchor="middle"
                fontSize={9}
                className="fill-muted/70"
              >
                T{history[i].turn}
              </text>
            ))}
          </svg>

          {/* Tooltip */}
          {hovered !== null && hoveredPoint && (
            <div className="pointer-events-none absolute top-2 right-3 rounded-lg border border-card-border bg-card px-3 py-2 text-xs shadow-card space-y-1">
              <div className="text-muted">Turn {history[hovered].turn}</div>
              <div className="font-semibold tabular-nums" style={{ color: accentColor }}>
                {series.label}: {series.format(hoveredPoint.value)}
              </div>
              {hoveredPoint2 && series.label2 && (
                <div className="font-semibold tabular-nums" style={{ color: secondaryColor }}>
                  {series.label2}: {series.format(hoveredPoint2.value)}
                </div>
              )}
              {activeMetric === "revenueCosts" && revenueCostsTooltip && (
                <div className="pt-1 mt-1 border-t border-card-border/30 space-y-0.5 text-muted">
                  <div>Operating income: {fmtMoney(revenueCostsTooltip.operatingIncome)}</div>
                  {revenueCostsTooltip.corporateTaxPaid !== 0 && (
                    <div>Taxes: {fmtMoney(revenueCostsTooltip.corporateTaxPaid)}</div>
                  )}
                  {revenueCostsTooltip.bondCouponIncome !== 0 && (
                    <div>Bond coupons: {fmtMoney(revenueCostsTooltip.bondCouponIncome)}</div>
                  )}
                  {revenueCostsTooltip.bondInterestDrag !== 0 && (
                    <div>Bond interest: {fmtMoney(revenueCostsTooltip.bondInterestDrag)}</div>
                  )}
                  {revenueCostsTooltip.netIncomeBeforeDividends != null && (
                    <div>Net income: {fmtMoney(revenueCostsTooltip.netIncomeBeforeDividends)}</div>
                  )}
                  {revenueCostsTooltip.dividendPaid !== 0 && (
                    <div>Dividends: {fmtMoney(revenueCostsTooltip.dividendPaid)}</div>
                  )}
                  {revenueCostsTooltip.dividendPaid !== 0 && (
                    <div>
                      Retained after dividends:{" "}
                      {fmtMoney(revenueCostsTooltip.retainedAfterDividends)}
                    </div>
                  )}
                  {history[hovered].marginDiagnostic && (
                    <>
                      <div>
                        Margin: {history[hovered].marginDiagnostic!.effectiveMargin.toFixed(1)}%
                      </div>
                      <div>
                        Commodity: {history[hovered].marginDiagnostic!.commodityInputMod.toFixed(1)}
                        pp
                      </div>
                      <div>
                        Surplus: {history[hovered].marginDiagnostic!.commoditySurplusMod.toFixed(1)}
                        pp
                      </div>
                      <div>
                        Export:{" "}
                        {(history[hovered].marginDiagnostic!.exportPremiumMod ?? 0).toFixed(1)}pp
                      </div>
                      <div>Macro: {history[hovered].marginDiagnostic!.macroMod.toFixed(1)}pp</div>
                      <div>
                        State: {history[hovered].marginDiagnostic!.stateMetricsMod.toFixed(1)}pp
                      </div>
                      <div>
                        Growth cost:{" "}
                        {(history[hovered].marginDiagnostic!.growthCostRatio * 100).toFixed(2)}%
                      </div>
                      <div>Sectors: {history[hovered].marginDiagnostic!.sectorCount}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Legend for dual-line charts */}
        {series.values2 && (
          <div className="flex items-center justify-center gap-6 mt-3 pt-3 border-t border-card-border/50">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-4 rounded-full"
                style={{ backgroundColor: accentColor }}
              />
              <span className="text-xs text-muted">{series.label}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-4 rounded-full"
                style={{ backgroundColor: secondaryColor }}
              />
              <span className="text-xs text-muted">{series.label2}</span>
            </div>
          </div>
        )}
      </div>

      {/* Summary stat cards — Period / High / Low / Change */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-card-border bg-card p-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Period</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-foreground">
            {periodTurns} turns
          </div>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">High</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-foreground">
            {series.format(highVal)}
          </div>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Low</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-foreground">
            {series.format(lowVal)}
          </div>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Change</div>
          <div
            className={`mt-1 text-lg font-bold tabular-nums ${changePct >= 0 ? "text-success" : "text-error"}`}
          >
            {changePct >= 0 ? "+" : ""}
            {changePct.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}
