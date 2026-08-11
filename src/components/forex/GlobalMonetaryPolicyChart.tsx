"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import type { CountryMacroSnapshot, MacroMetric } from "@/app/country/[code]/forex/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { CountryFlag } from "@/components/CountryFlag";
import { ForexChartTimeframeTabs } from "@/components/forex/ForexChartTimeframeTabs";
import {
  slicePointsByTurnWindow,
  type ForexChartTimeframe,
} from "@/components/forex/forexChartTimeframe";
import { alignSeries, collectTurns } from "@/components/forex/chartSeriesUtils";
import { CURRENCY_COLORS } from "@/components/forex/currencyDisplay";

interface Props {
  countries: CountryMacroSnapshot[];
  /**
   * When set, only these countries start visible on the chart; others are
   * available under "More countries".
   */
  defaultCountryIds?: CountryId[];
}

const WIDTH = 600;
const HEIGHT = 220;
const PAD_LEFT = 52;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 36;
const INNER_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const INNER_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

function selectHistory(
  c: CountryMacroSnapshot,
  metric: MacroMetric,
  gdpMode: "nominal" | "real"
): { turn: number; value: number }[] {
  if (metric === "inflation") return c.inflationHistory;
  if (metric === "interest") return c.interestRateHistory;
  if (gdpMode === "nominal") return c.gdpGrowthHistory;
  return realGdpGrowthSnapshots(c);
}

/** Last inflation snapshot at or before `turn` (sorted ascending). */
function inflationAtOrBefore(sortedInfl: { turn: number; value: number }[], turn: number): number {
  let last = 0;
  for (const p of sortedInfl) {
    if (p.turn <= turn) last = p.value;
    else break;
  }
  return last;
}

/** Approx. real growth per turn: nominal GDP growth − inflation (percentage points). */
function realGdpGrowthSnapshots(c: CountryMacroSnapshot): { turn: number; value: number }[] {
  const inflByTurn = new Map(c.inflationHistory.map((p) => [p.turn, p.value]));
  const sortedInfl = [...c.inflationHistory].sort((a, b) => a.turn - b.turn);
  return c.gdpGrowthHistory.map(({ turn, value }) => {
    const infl = inflByTurn.get(turn) ?? inflationAtOrBefore(sortedInfl, turn);
    return { turn, value: value - infl };
  });
}

function formatMetricValue(v: number): string {
  return `${v.toFixed(2)}%`;
}

const METRIC_LABELS: Record<MacroMetric, string> = {
  inflation: "Inflation",
  interest: "Policy rate",
  gdp: "GDP growth",
};

/** Consistent ordering for multi-metric overlay (one country). */
const METRIC_ORDER: MacroMetric[] = ["inflation", "interest", "gdp"];

/** Line colors when multiple metrics share one country (distinct from currency colors). */
const METRIC_LINE_COLORS: Record<MacroMetric, string> = {
  inflation: "var(--color-warning)",
  interest: "var(--color-primary)",
  gdp: "var(--color-success)",
};

export function GlobalMonetaryPolicyChart({ countries, defaultCountryIds }: Props) {
  const [timeframe, setTimeframe] = useState<ForexChartTimeframe>("48h");

  const windowedCountries = useMemo(
    () =>
      countries.map((c) => ({
        ...c,
        inflationHistory: slicePointsByTurnWindow(c.inflationHistory, timeframe),
        interestRateHistory: slicePointsByTurnWindow(c.interestRateHistory, timeframe),
        gdpGrowthHistory: slicePointsByTurnWindow(c.gdpGrowthHistory, timeframe),
      })),
    [countries, timeframe]
  );

  const [selectedMetrics, setSelectedMetrics] = useState<Set<MacroMetric>>(
    () => new Set<MacroMetric>(["inflation"])
  );
  /** Nominal GDP growth vs real (nominal − inflation); only applies when GDP is selected */
  const [gdpMode, setGdpMode] = useState<"nominal" | "real">("nominal");
  /** Nations toggled off the chart (empty set = all visible). */
  const [hiddenCountryIds, setHiddenCountryIds] = useState<Set<CountryId>>(() => new Set());
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const preferredCountryIds = useMemo(() => {
    if (!defaultCountryIds?.length) return null;
    const available = new Set(countries.map((c) => c.countryId));
    const preferred = defaultCountryIds.filter((id) => available.has(id));
    return preferred.length > 0 ? preferred : null;
  }, [defaultCountryIds, countries]);

  useEffect(() => {
    if (defaultsApplied || !preferredCountryIds) return;
    const preferred = new Set(preferredCountryIds);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed chart to player nations once
    setHiddenCountryIds(
      new Set(countries.filter((c) => !preferred.has(c.countryId)).map((c) => c.countryId))
    );
    setDefaultsApplied(true);
  }, [defaultsApplied, preferredCountryIds, countries]);

  const primaryCountries = useMemo(() => {
    if (!preferredCountryIds) return countries;
    const preferred = new Set(preferredCountryIds);
    return countries.filter((c) => preferred.has(c.countryId));
  }, [preferredCountryIds, countries]);

  const moreCountries = useMemo(() => {
    if (!preferredCountryIds) return [] as CountryMacroSnapshot[];
    const preferred = new Set(preferredCountryIds);
    return countries.filter((c) => !preferred.has(c.countryId));
  }, [preferredCountryIds, countries]);

  const activeCountries = useMemo(
    () => windowedCountries.filter((c) => !hiddenCountryIds.has(c.countryId)),
    [windowedCountries, hiddenCountryIds]
  );

  /** Multiple metrics at once only when exactly one nation is on the chart. */
  const singleCountryOverlay = activeCountries.length === 1;

  useEffect(() => {
    if (singleCountryOverlay) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedMetrics((prev) => {
      if (prev.size <= 1) return prev;
      const keep = METRIC_ORDER.find((m) => prev.has(m)) ?? "inflation";
      return new Set<MacroMetric>([keep]);
    });
  }, [singleCountryOverlay]);

  const metricsForChart = useMemo(() => {
    const picked = METRIC_ORDER.filter((m) => selectedMetrics.has(m));
    if (picked.length === 0) return ["inflation"] as MacroMetric[];
    if (!singleCountryOverlay) return [picked[0]!];
    return picked;
  }, [selectedMetrics, singleCountryOverlay]);

  const chartSeries = useMemo(() => {
    const rows: { country: CountryMacroSnapshot; metric: MacroMetric }[] = [];
    for (const c of activeCountries) {
      for (const metric of metricsForChart) {
        rows.push({ country: c, metric });
      }
    }
    return rows;
  }, [activeCountries, metricsForChart]);

  const historiesForChart = useMemo(
    () => chartSeries.map(({ country, metric: m }) => selectHistory(country, m, gdpMode)),
    [chartSeries, gdpMode]
  );

  const turns = useMemo(() => collectTurns(historiesForChart), [historiesForChart]);

  /** Per-turn snapshot values aligned to `turns` (same units as game / API — not indexed). */
  const seriesValues = useMemo(() => {
    if (turns.length === 0) return [] as number[][];
    return chartSeries.map(({ country, metric: m }) =>
      alignSeries(selectHistory(country, m, gdpMode), turns)
    );
  }, [chartSeries, gdpMode, turns]);

  const toggleMetric = useCallback(
    (m: MacroMetric) => {
      setSelectedMetrics((prev) => {
        if (!singleCountryOverlay) {
          return new Set<MacroMetric>([m]);
        }
        const next = new Set(prev);
        if (next.has(m)) {
          if (next.size <= 1) return next;
          next.delete(m);
        } else {
          next.add(m);
        }
        return next;
      });
    },
    [singleCountryOverlay]
  );

  const toggleCountryOnChart = useCallback(
    (countryId: CountryId) => {
      setHiddenCountryIds((prev) => {
        const next = new Set(prev);
        const visibleBefore = countries.filter((c) => !next.has(c.countryId)).length;
        if (!next.has(countryId)) {
          if (visibleBefore <= 1) return prev;
          next.add(countryId);
        } else {
          next.delete(countryId);
        }
        return next;
      });
    },
    [countries]
  );

  const showAllCountries = useCallback(() => {
    setHiddenCountryIds(new Set());
  }, []);

  const hasAnyMacroHistory = useMemo(
    () =>
      countries.some(
        (c) =>
          c.inflationHistory.length > 0 ||
          c.interestRateHistory.length > 0 ||
          c.gdpGrowthHistory.length > 0
      ),
    [countries]
  );

  if (countries.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center text-muted">
        No macro data available
      </div>
    );
  }

  if (!hasAnyMacroHistory) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center text-muted">
        Not enough history to chart monetary indicators yet
      </div>
    );
  }

  if (turns.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-card-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Global monetary policy
          </h2>
          <ForexChartTimeframeTabs
            value={timeframe}
            onChange={(tf: ForexChartTimeframe) => {
              setTimeframe(tf);
              setHoverIdx(null);
            }}
            idPrefix="macro-chart"
          />
        </div>
        <div className="p-6 text-center text-muted text-sm">
          No macro snapshots in this range — choose a longer window or wait for more turns.
        </div>
      </div>
    );
  }

  const allValues = seriesValues.flat();
  const dataMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const dataMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  const padding = (dataMax - dataMin) * 0.12 || 0.25;
  const crossesZero = dataMin < 0 && dataMax > 0;
  const yMin = dataMin - padding;
  const yMax = dataMax + padding;
  const yRange = yMax - yMin || 1;

  const maxLen = turns.length;
  const toX = (i: number) => PAD_LEFT + (i / Math.max(maxLen - 1, 1)) * INNER_W;
  const toY = (v: number) => PAD_TOP + (1 - (v - yMin) / yRange) * INNER_H;

  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (yRange / 4) * i);

  const xTickCount = Math.min(6, maxLen);
  const xTickIndices = Array.from({ length: xTickCount }, (_, i) =>
    Math.round((i / Math.max(xTickCount - 1, 1)) * (maxLen - 1))
  );

  const zeroY = crossesZero ? toY(0) : null;

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-card-border flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Global monetary policy
          </h2>
          <ForexChartTimeframeTabs
            value={timeframe}
            onChange={(tf: ForexChartTimeframe) => {
              setTimeframe(tf);
              setHoverIdx(null);
            }}
            idPrefix="macro-chart"
          />
          <div
            className="flex flex-wrap gap-1 rounded-lg border border-card-border bg-card-muted p-1"
            role={singleCountryOverlay ? "group" : "tablist"}
            aria-label={
              singleCountryOverlay
                ? "Macro indicators — select one or more when a single country is shown"
                : "Macro indicator"
            }
          >
            {METRIC_ORDER.map((m) => (
              <button
                key={m}
                type="button"
                role={singleCountryOverlay ? undefined : "tab"}
                aria-pressed={singleCountryOverlay ? selectedMetrics.has(m) : undefined}
                aria-selected={singleCountryOverlay ? undefined : selectedMetrics.has(m)}
                onClick={() => toggleMetric(m)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  selectedMetrics.has(m)
                    ? "bg-primary/15 text-primary"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {METRIC_LABELS[m]}
              </button>
            ))}
          </div>
          {selectedMetrics.has("gdp") && (
            <div
              className="flex flex-wrap gap-1 rounded-lg border border-card-border bg-card-muted p-1 w-fit"
              role="tablist"
              aria-label="GDP growth basis"
            >
              <button
                type="button"
                role="tab"
                aria-selected={gdpMode === "nominal"}
                onClick={() => setGdpMode("nominal")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  gdpMode === "nominal"
                    ? "bg-primary/15 text-primary"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Nominal
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={gdpMode === "real"}
                onClick={() => setGdpMode("real")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  gdpMode === "real"
                    ? "bg-primary/15 text-primary"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Real GDP growth
              </button>
            </div>
          )}
          <p className="text-xs text-muted">
            {singleCountryOverlay ? (
              <>
                With one nation on the chart, select multiple indicators to overlay them on the same
                % scale.
                {metricsForChart.length > 1
                  ? " Lines use distinct colors per indicator."
                  : ` ${METRIC_LABELS[metricsForChart[0]!]} — snapshot each turn.`}
                {selectedMetrics.has("gdp") &&
                  gdpMode === "real" &&
                  " Real GDP row is nominal GDP growth minus inflation."}
              </>
            ) : metricsForChart[0] === "inflation" ? (
              "Annualized inflation rate — snapshot each turn"
            ) : metricsForChart[0] === "interest" ? (
              "Central bank policy rate — snapshot each turn"
            ) : gdpMode === "nominal" ? (
              "National GDP growth metric — snapshot each turn (same as in-game)"
            ) : (
              "Approx. real growth: nominal GDP growth minus inflation (percentage points per turn)"
            )}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end sm:min-w-[220px]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
            Countries on chart
          </span>
          <div className="flex flex-wrap gap-2 justify-end">
            {primaryCountries.map((c) => {
              const cfg = COUNTRY_CONFIGS[c.countryId];
              const visible = !hiddenCountryIds.has(c.countryId);
              return (
                <button
                  key={c.countryId}
                  type="button"
                  aria-pressed={visible}
                  aria-label={
                    visible
                      ? `${cfg.name}: shown — click to hide`
                      : `${cfg.name}: hidden — click to show`
                  }
                  onClick={() => toggleCountryOnChart(c.countryId)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    visible
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-card-border bg-card-muted/50 text-muted hover:border-card-border hover:text-foreground"
                  }`}
                >
                  <CountryFlag country={c.countryId} size="sm" />
                  <span>{cfg.name}</span>
                  <span className="font-normal text-muted/80">({c.currencyCode})</span>
                </button>
              );
            })}
          </div>
          {moreCountries.length > 0 && (
            <details className="group w-full sm:w-auto sm:max-w-md">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-end gap-1.5 text-xs text-muted hover:text-foreground transition-colors">
                <span
                  className="select-none transition-transform duration-200 group-open:rotate-90"
                  aria-hidden
                >
                  ▸
                </span>
                More countries
                <span className="tabular-nums text-muted/70">({moreCountries.length})</span>
              </summary>
              <div className="mt-2 flex flex-wrap gap-2 justify-end">
                {moreCountries.map((c) => {
                  const cfg = COUNTRY_CONFIGS[c.countryId];
                  const visible = !hiddenCountryIds.has(c.countryId);
                  return (
                    <button
                      key={c.countryId}
                      type="button"
                      aria-pressed={visible}
                      aria-label={
                        visible
                          ? `${cfg.name}: shown — click to hide`
                          : `${cfg.name}: hidden — click to show`
                      }
                      onClick={() => toggleCountryOnChart(c.countryId)}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        visible
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-card-border bg-card-muted/50 text-muted hover:border-card-border hover:text-foreground"
                      }`}
                    >
                      <CountryFlag country={c.countryId} size="sm" />
                      <span>{cfg.name}</span>
                      <span className="font-normal text-muted/80">({c.currencyCode})</span>
                    </button>
                  );
                })}
              </div>
            </details>
          )}
          {hiddenCountryIds.size > 0 && (
            <button
              type="button"
              onClick={showAllCountries}
              className="self-end text-xs text-muted underline-offset-2 transition-colors hover:text-primary hover:underline"
            >
              Show all countries
            </button>
          )}
        </div>
      </div>

      <div className="p-4">
        <svg
          key={timeframe}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD_LEFT}
                x2={WIDTH - PAD_RIGHT}
                y1={toY(tick)}
                y2={toY(tick)}
                stroke="var(--color-card-border)"
                strokeWidth="0.5"
              />
              <text
                x={PAD_LEFT - 6}
                y={toY(tick) + 3}
                textAnchor="end"
                className="fill-muted"
                style={{ fontSize: "9px" }}
              >
                {`${tick.toFixed(2)}%`}
              </text>
            </g>
          ))}

          {zeroY !== null && (
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={zeroY}
              y2={zeroY}
              stroke="var(--color-muted)"
              strokeWidth="1"
              strokeDasharray="4,3"
              opacity="0.5"
            />
          )}

          {xTickIndices.map((idx) => {
            const turn = turns[idx];
            if (turn === undefined) return null;
            return (
              <text
                key={idx}
                x={toX(idx)}
                y={HEIGHT - 6}
                textAnchor="middle"
                className="fill-muted"
                style={{ fontSize: "9px" }}
              >
                T{turn}
              </text>
            );
          })}

          <line
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y1={PAD_TOP + INNER_H}
            y2={PAD_TOP + INNER_H}
            stroke="var(--color-card-border)"
            strokeWidth="0.5"
          />

          {seriesValues.map((values, seriesIdx) => {
            if (!values?.length) return null;
            const row = chartSeries[seriesIdx];
            if (!row) return null;
            const points = values.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
            const useMetricLineColors = singleCountryOverlay && metricsForChart.length > 1;
            const stroke = useMetricLineColors
              ? METRIC_LINE_COLORS[row.metric]
              : (CURRENCY_COLORS[row.country.currencyCode] ?? "var(--color-muted)");
            return (
              <polyline
                key={`${row.country.countryId}-${row.metric}`}
                points={points}
                fill="none"
                stroke={stroke}
                strokeWidth="2"
                strokeLinejoin="round"
              />
            );
          })}

          {Array.from({ length: maxLen }, (_, i) => (
            <rect
              key={i}
              x={toX(i) - INNER_W / maxLen / 2}
              y={PAD_TOP}
              width={INNER_W / maxLen}
              height={INNER_H}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          ))}

          {hoverIdx !== null && (
            <line
              x1={toX(hoverIdx)}
              x2={toX(hoverIdx)}
              y1={PAD_TOP}
              y2={PAD_TOP + INNER_H}
              stroke="var(--color-muted)"
              strokeWidth="1"
              strokeDasharray="3,3"
            />
          )}
        </svg>

        {hoverIdx !== null && (
          <div className="flex flex-wrap items-center justify-center gap-4 mt-1 text-xs text-muted">
            {chartSeries.map((row, seriesIdx) => {
              const v = seriesValues[seriesIdx]?.[hoverIdx];
              const turn = turns[hoverIdx];
              if (v === undefined || turn === undefined) return null;
              const useMetricLineColors = singleCountryOverlay && metricsForChart.length > 1;
              const swatch = useMetricLineColors
                ? METRIC_LINE_COLORS[row.metric]
                : (CURRENCY_COLORS[row.country.currencyCode] ?? "var(--color-muted)");
              const label = useMetricLineColors
                ? METRIC_LABELS[row.metric]
                : row.country.currencyCode;
              const emphasisInflationOrGdp = row.metric === "gdp" || row.metric === "inflation";
              return (
                <span
                  key={`${row.country.countryId}-${row.metric}`}
                  className="flex items-center gap-1"
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: swatch }}
                  />
                  <span className="font-medium">{label}:</span>
                  <span
                    className={
                      emphasisInflationOrGdp
                        ? v >= 0
                          ? "text-success"
                          : "text-error"
                        : "text-foreground"
                    }
                  >
                    {formatMetricValue(v)}
                  </span>
                  <span className="text-muted/60">T{turn}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
