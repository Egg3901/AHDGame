"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import type { ExchangeRateDisplay } from "@/app/country/[code]/forex/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { ForexChartTimeframeTabs } from "@/components/forex/ForexChartTimeframeTabs";
import {
  slicePointsByTurnWindow,
  type ForexChartTimeframe,
} from "@/components/forex/forexChartTimeframe";
import { alignSeries, collectTurns } from "@/components/forex/chartSeriesUtils";
import { CURRENCY_COLORS, CURRENCY_FLAG_CODE } from "@/components/forex/currencyDisplay";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { CountryFlag } from "@/components/CountryFlag";
import { computeStrengthVsReferencePercent } from "@/lib/forex/rateSemantics";

interface Props {
  rates: ExchangeRateDisplay[];
  /**
   * When set, the chart starts with these series on (player-enabled currencies).
   * Remaining currencies stay available under "More currencies".
   */
  defaultCurrencyCodes?: CurrencyCode[];
}

const WIDTH = 600;
const HEIGHT = 200;
const PAD_LEFT = 52;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 36;
const INNER_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const INNER_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

// Normalize a series to currency-strength % change from its first point.
// Rates are stored as currency-per-anchor, so lower = stronger.
function normalizeToStrengthPercent(values: number[]): number[] {
  const base = values[0];
  if (!base) return values.map(() => 0);
  return values.map((v) => computeStrengthVsReferencePercent(v, base));
}

function formatPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function formatAbsolute(v: number): string {
  if (v >= 10) return v.toFixed(2);
  return v.toFixed(4);
}

export function RateChart({ rates, defaultCurrencyCodes }: Props) {
  const [timeframe, setTimeframe] = useState<ForexChartTimeframe>("48h");

  const ratesWithHistory = useMemo(
    () =>
      rates
        .map((r) => ({
          ...r,
          rateHistory: slicePointsByTurnWindow(r.rateHistory, timeframe),
        }))
        .filter((r) => r.rateHistory.length > 1),
    [rates, timeframe]
  );

  const windowCodes = useMemo(
    () => new Set(ratesWithHistory.map((r) => r.currencyCode)),
    [ratesWithHistory]
  );

  const preferredCodes = useMemo(() => {
    if (!defaultCurrencyCodes?.length) return null;
    const preferred = defaultCurrencyCodes.filter((c) => windowCodes.has(c));
    return preferred.length > 0 ? preferred : null;
  }, [defaultCurrencyCodes, windowCodes]);

  /** User toggles; null = show every currency in the current window */
  const [seriesSelection, setSeriesSelection] = useState<Set<CurrencyCode> | null>(null);
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  useEffect(() => {
    if (defaultsApplied || !preferredCodes) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed chart to player currencies once
    setSeriesSelection(new Set(preferredCodes));
    setDefaultsApplied(true);
  }, [defaultsApplied, preferredCodes]);

  const primaryCodes = useMemo(() => {
    if (preferredCodes) return preferredCodes;
    return ratesWithHistory.map((r) => r.currencyCode);
  }, [preferredCodes, ratesWithHistory]);

  const moreRates = useMemo(() => {
    if (!preferredCodes) return [] as typeof ratesWithHistory;
    const primary = new Set(preferredCodes);
    return ratesWithHistory.filter((r) => !primary.has(r.currencyCode));
  }, [preferredCodes, ratesWithHistory]);

  const activeSeries = useMemo(() => {
    if (seriesSelection === null) return windowCodes;
    const next = new Set<CurrencyCode>();
    for (const c of seriesSelection) {
      if (windowCodes.has(c)) next.add(c);
    }
    return next.size > 0 ? next : windowCodes;
  }, [seriesSelection, windowCodes]);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const activeRates = useMemo(
    () => ratesWithHistory.filter((r) => activeSeries.has(r.currencyCode)),
    [ratesWithHistory, activeSeries]
  );

  // Use absolute scale when only one series is visible, % change otherwise
  const usePercent = activeSeries.size > 1;

  const turns = useMemo(() => collectTurns(activeRates.map((r) => r.rateHistory)), [activeRates]);

  const seriesValues = useMemo(() => {
    if (turns.length === 0) return [] as number[][];
    const aligned = activeRates.map((r) => alignSeries(r.rateHistory, turns));
    return aligned.map((raw) => (usePercent ? normalizeToStrengthPercent(raw) : raw));
  }, [activeRates, usePercent, turns]);

  const alignedRawBySeries = useMemo(
    () => activeRates.map((r) => alignSeries(r.rateHistory, turns)),
    [activeRates, turns]
  );

  const toggleSeries = useCallback(
    (code: CurrencyCode) => {
      setSeriesSelection((prev) => {
        const current =
          prev === null
            ? new Set(windowCodes)
            : (() => {
                const s = new Set<CurrencyCode>();
                for (const c of prev) {
                  if (windowCodes.has(c)) s.add(c);
                }
                return s.size > 0 ? s : new Set(windowCodes);
              })();
        const next = new Set(current);
        if (next.has(code)) {
          if (next.size > 1) next.delete(code);
        } else {
          next.add(code);
        }
        return next;
      });
    },
    [windowCodes]
  );

  if (ratesWithHistory.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center text-muted">
        Not enough history to display chart
      </div>
    );
  }

  const allValues = seriesValues.flat();
  const dataMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const dataMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  const padding = (dataMax - dataMin) * 0.12 || (usePercent ? 0.5 : 0.01);
  // When using percent mode, always include 0 in the range
  const yMin = usePercent ? Math.min(dataMin - padding, -0.5) : dataMin - padding;
  const yMax = usePercent ? Math.max(dataMax + padding, 0.5) : dataMax + padding;
  const yRange = yMax - yMin || 1;

  const maxLen = Math.max(turns.length, 1);

  const toX = (i: number) => PAD_LEFT + (i / Math.max(maxLen - 1, 1)) * INNER_W;
  const toY = (v: number) => PAD_TOP + (1 - (v - yMin) / yRange) * INNER_H;

  // Y-axis: 5 ticks
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (yRange / 4) * i);

  // X-axis: up to 6 turn labels
  const xTickCount = Math.min(6, maxLen);
  const xTickIndices = Array.from({ length: xTickCount }, (_, i) =>
    Math.round((i / Math.max(xTickCount - 1, 1)) * (maxLen - 1))
  );

  // Zero line for percent mode
  const zeroY = usePercent ? toY(0) : null;

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-card-border flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2 min-w-0">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Rate History
          </h2>
          <ForexChartTimeframeTabs
            value={timeframe}
            onChange={(tf: ForexChartTimeframe) => {
              setTimeframe(tf);
              setHoverIdx(null);
            }}
            idPrefix="rate-chart"
          />
          {usePercent ? (
            <p className="text-xs text-muted">
              Strength change from start of visible range. Positive = stronger, negative = weaker.
            </p>
          ) : (
            <p className="text-xs text-muted">
              Raw rate history in currency per ₳. Higher = weaker currency, lower = stronger.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:items-end min-w-0">
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {primaryCodes.map((code) => {
              const r = ratesWithHistory.find((row) => row.currencyCode === code);
              if (!r) return null;
              const color = CURRENCY_COLORS[r.currencyCode] ?? "var(--color-muted)";
              const isActive = activeSeries.has(r.currencyCode);
              return (
                <button
                  key={r.currencyCode}
                  type="button"
                  onClick={() => toggleSeries(r.currencyCode)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
                    isActive ? "" : "opacity-40 hover:opacity-70"
                  }`}
                  style={
                    isActive
                      ? { backgroundColor: color + "1a", color }
                      : { color: "var(--color-muted)" }
                  }
                >
                  <CountryFlag
                    country={(CURRENCY_FLAG_CODE[r.currencyCode] ?? r.currencyCode).toUpperCase()}
                    size="sm"
                    className="rounded-[1px]"
                  />
                  {CURRENCY_SYMBOLS[r.currencyCode] ?? r.currencyCode}
                </button>
              );
            })}
          </div>
          {moreRates.length > 0 && (
            <details className="group w-full sm:w-auto sm:max-w-md">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-end gap-1.5 text-xs text-muted hover:text-foreground transition-colors">
                <span
                  className="select-none transition-transform duration-200 group-open:rotate-90"
                  aria-hidden
                >
                  ▸
                </span>
                More currencies
                <span className="tabular-nums text-muted/70">({moreRates.length})</span>
              </summary>
              <div className="mt-2 flex flex-wrap gap-2 sm:justify-end">
                {moreRates.map((r) => {
                  const color = CURRENCY_COLORS[r.currencyCode] ?? "var(--color-muted)";
                  const isActive = activeSeries.has(r.currencyCode);
                  return (
                    <button
                      key={r.currencyCode}
                      type="button"
                      onClick={() => toggleSeries(r.currencyCode)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
                        isActive ? "" : "opacity-40 hover:opacity-70"
                      }`}
                      style={
                        isActive
                          ? { backgroundColor: color + "1a", color }
                          : { color: "var(--color-muted)" }
                      }
                    >
                      <CountryFlag
                        country={(
                          CURRENCY_FLAG_CODE[r.currencyCode] ?? r.currencyCode
                        ).toUpperCase()}
                        size="sm"
                        className="rounded-[1px]"
                      />
                      {CURRENCY_SYMBOLS[r.currencyCode] ?? r.currencyCode}
                    </button>
                  );
                })}
              </div>
            </details>
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
          {/* Y-axis grid lines + labels */}
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
                {usePercent ? formatPct(tick) : formatAbsolute(tick)}
              </text>
            </g>
          ))}

          {/* Zero line (percent mode only) */}
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

          {/* X-axis labels */}
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

          {/* X-axis baseline */}
          <line
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y1={PAD_TOP + INNER_H}
            y2={PAD_TOP + INNER_H}
            stroke="var(--color-card-border)"
            strokeWidth="0.5"
          />

          {/* Series lines */}
          {activeRates.map((r, seriesIdx) => {
            const values = seriesValues[seriesIdx];
            if (!values?.length) return null;
            const points = values.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
            return (
              <polyline
                key={r.currencyCode}
                points={points}
                fill="none"
                stroke={CURRENCY_COLORS[r.currencyCode] ?? "var(--color-muted)"}
                strokeWidth="2"
                strokeLinejoin="round"
              />
            );
          })}

          {/* Hover columns */}
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

          {/* Hover crosshair */}
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

        {/* Hover tooltip */}
        {hoverIdx !== null && (
          <div className="flex flex-wrap items-center justify-center gap-4 mt-1 text-xs text-muted">
            {activeRates.map((r, seriesIdx) => {
              const turn = turns[hoverIdx];
              const normalizedVal = seriesValues[seriesIdx]?.[hoverIdx];
              const rawAligned = alignedRawBySeries[seriesIdx]?.[hoverIdx];
              if (turn === undefined || normalizedVal === undefined || rawAligned === undefined)
                return null;
              return (
                <span key={r.currencyCode} className="flex items-center gap-1">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: CURRENCY_COLORS[r.currencyCode] ?? "var(--color-muted)",
                    }}
                  />
                  <span className="font-medium">{r.currencyCode}:</span>
                  {usePercent ? (
                    <span className={normalizedVal >= 0 ? "text-success" : "text-error"}>
                      {formatPct(normalizedVal)}
                    </span>
                  ) : (
                    <span>{formatAbsolute(rawAligned)}</span>
                  )}
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
