"use client";

import { useState, useMemo, useRef, useId } from "react";
import { Skeleton, Tooltip as InfoTooltip } from "@/components/ui";
import { getExchangeLabel } from "@/lib/constants/exchangeRegistry";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import type { ExchangeFilter, MarketCapPoint } from "../types";

const MC_CHART_WIDTH = 700;
const MC_CHART_HEIGHT = 240;
const VOL_HEIGHT = 32;
const VOL_GAP = 6;
const MC_PAD = { top: 20, right: 24, bottom: 48, left: 72 };

type Timeframe = "24h" | "48h" | "5y" | "all";

const TIMEFRAME_ORDER: Record<Timeframe, number> = { "24h": 0, "48h": 1, "5y": 2, all: 3 };

const TIMEFRAME_TURNS: Record<Timeframe, number> = {
  "24h": 24,
  "48h": 48,
  "5y": 240,
  all: Infinity,
};

const TIMEFRAME_META: { key: Timeframe; label: string; title: string }[] = [
  { key: "24h", label: "24h", title: "Last 24 turns (about 6 game-months)" },
  { key: "48h", label: "48h", title: "Last 48 turns (one game year)" },
  { key: "5y", label: "5y", title: "Last 240 turns (five game years)" },
  { key: "all", label: "All", title: "Full recorded history" },
];

function turnToRealDate(turn: number, newestTurn: number, newestTurnDateIso: string): Date {
  return new Date(new Date(newestTurnDateIso).getTime() - (newestTurn - turn) * 3_600_000);
}

/**
 * Raw history turn to the calendar year the player sees.
 *
 * `calendarOffset` is the world's `preIterationTurns`: the founding phase burns
 * raw turns while the calendar stays pinned to the era start, so the raw counter
 * runs ahead of the date by exactly that many turns forever after. Without it a
 * world with a 48-turn founding cycle labelled its chart axis a whole year ahead
 * of the status bar.
 */
function turnToGameYear(turn: number, startingYear: number, calendarOffset = 0): number {
  return startingYear + Math.floor((Math.max(1, turn - calendarOffset) - 1) / 48);
}

/** Inverse of {@link turnToGameYear}: the raw turn a calendar year opens on. */
function gameYearStartTurn(year: number, startingYear: number, calendarOffset = 0): number {
  return 1 + (year - startingYear) * 48 + calendarOffset;
}

function isSameUTCDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function MarketOverview({
  exchangeFilter,
  timeframe,
  onTimeframeChange,
  history,
  newestTurnDate,
  historyLoading,
}: {
  exchangeFilter: ExchangeFilter;
  /**
   * Page-shared short timeframe (also drives the stats strip, stocks, and
   * funds tables). The chart maps 1h onto its 24-turn window: one turn of
   * history is too few points to draw.
   */
  timeframe: "1h" | "24h" | "48h";
  onTimeframeChange: (tf: "24h" | "48h") => void;
  /** Shared history window fetched once by the page (newest-first sliceable). */
  history: MarketCapPoint[];
  newestTurnDate: string | null;
  historyLoading: boolean;
}) {
  const { formatAmount } = useCurrency();
  // Preset-aware year axis. Falls back to STARTING_YEAR if status not yet loaded.
  const turnStatus = useGameTurnStatus();
  const startingYearRef = turnStatus?.startingYear ?? STARTING_YEAR;
  const calendarOffset = turnStatus?.preIterationTurns ?? 0;
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  // Chart-only extensions beyond the shared strip horizons.
  const [longTf, setLongTf] = useState<"5y" | "all" | null>(null);
  const [animDir, setAnimDir] = useState<"compress" | "expand" | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const prevTfRef = useRef<Timeframe>("48h");
  const rawId = useId();
  const gradId = `mc-${rawId.replace(/:/g, "")}`;

  const loading = historyLoading;
  const effective: Timeframe = longTf ?? (timeframe === "1h" ? "24h" : timeframe);

  const handleTimeframeChange = (tf: Timeframe) => {
    if (tf === effective) return;
    const goingLonger = TIMEFRAME_ORDER[tf] > TIMEFRAME_ORDER[prevTfRef.current];
    prevTfRef.current = tf;
    setAnimDir(goingLonger ? "expand" : "compress");
    setAnimKey((k) => k + 1);
    if (tf === "5y" || tf === "all") {
      setLongTf(tf);
    } else {
      setLongTf(null);
      onTimeframeChange(tf);
    }
  };

  const availableSectors = useMemo(() => {
    const sectors = new Set<string>();
    for (const pt of history) {
      if (pt.bySector) {
        for (const k of Object.keys(pt.bySector)) sectors.add(k);
      }
    }
    return [...sectors].sort();
  }, [history]);

  const slicedHistory = useMemo(() => {
    const limit = TIMEFRAME_TURNS[effective];
    const raw = limit === Infinity ? history : history.slice(-limit);
    // For "all", downsample to ~200 visible points so the SVG stays fast
    if (effective === "all" && raw.length > 200) {
      const step = Math.ceil(raw.length / 200);
      return raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
    }
    return raw;
  }, [history, effective]);

  const chartData = useMemo(() => {
    if (sectorFilter === "all") return slicedHistory;
    return slicedHistory.map((pt) => ({
      ...pt,
      marketCap: pt.bySector?.[sectorFilter as CorporationType] ?? 0,
    }));
  }, [slicedHistory, sectorFilter]);

  const renderChart = () => {
    if (loading) {
      return (
        <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
          <div className="mb-5">
            <Skeleton className="h-4 w-32 rounded-md mb-2" />
            <Skeleton className="h-8 w-48 rounded-md" />
          </div>
          <Skeleton className="h-[240px] w-full rounded-lg" />
        </div>
      );
    }

    if (chartData.length < 2) return null;

    const innerW = MC_CHART_WIDTH - MC_PAD.left - MC_PAD.right;
    const lineZoneH = MC_CHART_HEIGHT - MC_PAD.top - MC_PAD.bottom - VOL_HEIGHT - VOL_GAP;
    const volZoneTop = MC_PAD.top + lineZoneH + VOL_GAP;

    const turns = chartData.map((p) => p.turn);
    const minTurn = turns[0];
    const maxTurn = turns[turns.length - 1];

    const caps = chartData.map((p) => p.marketCap);
    // Keep the intra-turn range inside the frame when it is drawn.
    const rangeVals = chartData.flatMap((p) => [p.high ?? p.marketCap, p.low ?? p.marketCap]);
    const minCap = Math.min(...caps, ...rangeVals);
    const maxCap = Math.max(...caps, ...rangeVals);
    const capPad = (maxCap - minCap) * 0.08 || maxCap * 0.05 || 1;
    const yMin = Math.max(0, minCap - capPad);
    const yMax = maxCap + capPad;

    const currentCap = caps[caps.length - 1];
    const firstCap = caps[0];
    const change = firstCap > 0 ? ((currentCap - firstCap) / firstCap) * 100 : 0;
    const isUp = change >= 0;
    const lineColor = isUp ? "var(--success)" : "var(--error)";

    const xScale = (turn: number) =>
      MC_PAD.left + ((turn - minTurn) / Math.max(maxTurn - minTurn, 1)) * innerW;
    const yScale = (val: number) =>
      MC_PAD.top + lineZoneH - ((val - yMin) / (yMax - yMin)) * lineZoneH;

    const linePath = chartData
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.turn)} ${yScale(p.marketCap)}`)
      .join(" ");

    const areaPath = [
      ...chartData.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.turn)} ${yScale(p.marketCap)}`),
      `L ${xScale(chartData[chartData.length - 1].turn)} ${MC_PAD.top + lineZoneH}`,
      `L ${xScale(chartData[0].turn)} ${MC_PAD.top + lineZoneH}`,
      "Z",
    ].join(" ");

    // Intra-turn range band (absent on pre-range records — then no band).
    const hasRange = chartData.every((p) => p.high != null && p.low != null);
    const bandPath = hasRange
      ? [
          ...chartData.map(
            (p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.turn)} ${yScale(p.high as number)}`
          ),
          ...[...chartData].reverse().map((p) => `L ${xScale(p.turn)} ${yScale(p.low as number)}`),
          "Z",
        ].join(" ")
      : null;

    const hoverPoint = hoverIdx != null ? chartData[hoverIdx] : null;
    const handleSvgMove = (e: { clientX: number }) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const x = ((e.clientX - rect.left) / rect.width) * MC_CHART_WIDTH;
      let best = 0;
      let bestDist = Infinity;
      chartData.forEach((p, i) => {
        const d = Math.abs(xScale(p.turn) - x);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setHoverIdx(best);
    };

    // Per-turn delta bars (market cap change magnitude)
    const deltas = chartData.map((p, i) => {
      if (i === 0) return { abs: 0, up: true };
      const prev = caps[i - 1];
      return { abs: Math.abs(p.marketCap - prev), up: p.marketCap >= prev };
    });
    const maxDelta = Math.max(...deltas.map((d) => d.abs), 1);
    const barW = Math.max(1, Math.min(8, (innerW / chartData.length) * 0.75));

    const yTicks = 4;
    const yTickVals = Array.from(
      { length: yTicks + 1 },
      (_, i) => yMin + (i / yTicks) * (yMax - yMin)
    );

    const exchangeLabel = exchangeFilter === "global" ? "Global" : getExchangeLabel(exchangeFilter);
    const xAxisLabelY = MC_PAD.top + lineZoneH + VOL_HEIGHT + VOL_GAP + 14;

    return (
      <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted inline-flex items-center">
              {exchangeLabel} Market Index
              <InfoTooltip content="Continuity-adjusted index: corporate actions that would otherwise jump the series (delistings, redenominations) are smoothed, so the line tracks market performance rather than raw capitalization. Raw totals are available per turn in the underlying history." />
            </h3>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold tabular-nums text-foreground tracking-tight">
                {formatAmount(currentCap)}
              </span>
              <span
                className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded-md ${
                  isUp ? "text-success bg-success/10" : "text-error bg-error/10"
                }`}
              >
                {isUp ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              {TIMEFRAME_META.map((tf) => (
                <button
                  key={tf.key}
                  onClick={() => handleTimeframeChange(tf.key)}
                  title={
                    timeframe === "1h" && tf.key === "24h"
                      ? "Tables show the 1-turn change; the chart draws the 24-turn window"
                      : tf.title
                  }
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                    effective === tf.key
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "bg-card-elevated border-card-border text-muted hover:text-foreground hover:bg-card-elevated/80"
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
            {availableSectors.length > 1 && (
              <select
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                className="text-xs bg-card-elevated border border-card-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-primary transition-colors hover:bg-card-elevated/80"
              >
                <option value="all">All Sectors</option>
                {availableSectors.map((s) => (
                  <option key={s} value={s}>
                    {CORPORATION_TYPE_LABELS[s as CorporationType] ?? s}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <style>{`
          @keyframes mkt-compress-in {
            from { transform: scaleX(1.06); opacity: 0.4; }
            to   { transform: scaleX(1);    opacity: 1;   }
          }
          @keyframes mkt-expand-out {
            from { transform: scaleX(0.94); opacity: 0.4; }
            to   { transform: scaleX(1);    opacity: 1;   }
          }
        `}</style>
        <div
          key={animKey}
          style={{
            transformOrigin: "right center",
            animation: animDir
              ? `${animDir === "compress" ? "mkt-compress-in" : "mkt-expand-out"} 0.32s cubic-bezier(0.4, 0, 0.2, 1) both`
              : undefined,
          }}
        >
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ background: lineColor }}
              />
              Market index
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-success/60" />
              <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-error/60" />
              Per-turn change
            </span>
            {bandPath && (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-4 rounded-[2px]"
                  style={{ background: lineColor, opacity: 0.25 }}
                />
                Intra-turn range
              </span>
            )}
          </div>
          <div
            className="relative"
            onMouseMove={handleSvgMove}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${MC_CHART_WIDTH} ${MC_CHART_HEIGHT}`}
              className="w-full h-auto"
              style={{ maxHeight: MC_CHART_HEIGHT }}
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={lineColor} stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid lines */}
              {yTickVals.map((yv, i) => (
                <line
                  key={i}
                  x1={MC_PAD.left}
                  x2={MC_PAD.left + innerW}
                  y1={yScale(yv)}
                  y2={yScale(yv)}
                  stroke="var(--card-border)"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
              ))}

              {/* Area fill */}
              <path d={areaPath} fill={`url(#${gradId})`} />

              {/* Intra-turn range band */}
              {bandPath && <path d={bandPath} fill={lineColor} opacity={0.1} />}

              {/* Line */}
              <path
                d={linePath}
                fill="none"
                stroke={lineColor}
                strokeWidth="1.75"
                strokeLinejoin="round"
                strokeLinecap="round"
              />

              {/* Current price dot */}
              <circle
                cx={xScale(chartData[chartData.length - 1].turn)}
                cy={yScale(currentCap)}
                r="3"
                fill={lineColor}
              />

              {/* Hover crosshair */}
              {hoverPoint && (
                <g>
                  <line
                    x1={xScale(hoverPoint.turn)}
                    x2={xScale(hoverPoint.turn)}
                    y1={MC_PAD.top}
                    y2={MC_PAD.top + lineZoneH}
                    stroke="var(--muted)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    opacity={0.7}
                  />
                  <circle
                    cx={xScale(hoverPoint.turn)}
                    cy={yScale(hoverPoint.marketCap)}
                    r="3.5"
                    fill="var(--card)"
                    stroke={lineColor}
                    strokeWidth="2"
                  />
                </g>
              )}

              {/* Delta bars */}
              {chartData.map((p, i) => {
                if (i === 0) return null;
                const { abs, up } = deltas[i];
                const barH = Math.max(1, (abs / maxDelta) * VOL_HEIGHT);
                const x = xScale(p.turn);
                return (
                  <rect
                    key={i}
                    x={x - barW / 2}
                    y={volZoneTop + VOL_HEIGHT - barH}
                    width={barW}
                    height={barH}
                    fill={up ? "var(--success)" : "var(--error)"}
                    opacity={0.45}
                    rx="0.5"
                  />
                );
              })}

              {/* Y-axis labels */}
              {yTickVals.map((yv, i) => (
                <text
                  key={i}
                  x={MC_PAD.left - 10}
                  y={yScale(yv) + 4}
                  textAnchor="end"
                  fontSize="10"
                  fontWeight="500"
                  fill="var(--muted)"
                >
                  {formatAmount(yv)}
                </text>
              ))}

              {/* X-axis labels — game years for 48h/5y/all, real times for 24h */}
              {newestTurnDate &&
                effective !== "24h" &&
                (() => {
                  const newestTurn = chartData[chartData.length - 1].turn;
                  const firstYear = turnToGameYear(minTurn, startingYearRef, calendarOffset);
                  const lastYear = turnToGameYear(maxTurn, startingYearRef, calendarOffset);
                  const boundaryTurns: number[] = [];
                  for (let y = firstYear; y <= lastYear + 1; y++) {
                    const t = gameYearStartTurn(y, startingYearRef, calendarOffset);
                    if (t >= minTurn && t <= maxTurn) boundaryTurns.push(t);
                  }
                  const MIN_SPACING = 60;
                  const visible: number[] = [];
                  for (let i = boundaryTurns.length - 1; i >= 0; i--) {
                    const t = boundaryTurns[i];
                    const x = xScale(t);
                    const nextX =
                      visible.length > 0 ? xScale(visible[visible.length - 1]) : Infinity;
                    if (nextX - x >= MIN_SPACING) visible.push(t);
                  }
                  visible.reverse();
                  return visible.map((t) => {
                    const d = turnToRealDate(t, newestTurn, newestTurnDate);
                    const month = d.getUTCMonth() + 1;
                    const day = d.getUTCDate();
                    const gameYear = turnToGameYear(t, startingYearRef, calendarOffset);
                    const x = xScale(t);
                    return (
                      <g key={t}>
                        <text
                          x={x}
                          y={xAxisLabelY}
                          textAnchor="middle"
                          fontSize="10"
                          fontWeight="500"
                          fill="var(--muted)"
                        >
                          {gameYear}
                        </text>
                        <text
                          x={x}
                          y={xAxisLabelY + 12}
                          textAnchor="middle"
                          fontSize="9"
                          fill="var(--muted)"
                          opacity="0.7"
                        >
                          ({month}/{day})
                        </text>
                      </g>
                    );
                  });
                })()}
              {newestTurnDate &&
                effective === "24h" &&
                (() => {
                  const newestTurn = chartData[chartData.length - 1].turn;
                  const tickCount = 4;
                  const step = Math.max(1, Math.floor(chartData.length / tickCount));
                  const tickTurns: number[] = [];
                  for (let i = 0; i < chartData.length; i += step)
                    tickTurns.push(chartData[i].turn);
                  if (tickTurns[tickTurns.length - 1] !== chartData[chartData.length - 1].turn) {
                    tickTurns.push(chartData[chartData.length - 1].turn);
                  }
                  const dates = tickTurns.map((t) => turnToRealDate(t, newestTurn, newestTurnDate));
                  const allSameDay = dates.every((d) => isSameUTCDay(d, dates[0]));
                  return tickTurns.map((t, i) => {
                    const d = dates[i];
                    let label: string;
                    if (allSameDay) {
                      const hh = String(d.getUTCHours()).padStart(2, "0");
                      const mm = String(d.getUTCMinutes()).padStart(2, "0");
                      label = `${hh}:${mm}`;
                    } else {
                      label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
                    }
                    return (
                      <text
                        key={t}
                        x={xScale(t)}
                        y={xAxisLabelY}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="500"
                        fill="var(--muted)"
                      >
                        {label}
                      </text>
                    );
                  });
                })()}
            </svg>
            {hoverPoint && (
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-card-border bg-card-elevated px-2.5 py-1.5 text-xs shadow-lg whitespace-nowrap"
                style={{
                  left: `${Math.min(88, Math.max(12, (xScale(hoverPoint.turn) / MC_CHART_WIDTH) * 100))}%`,
                  top: 0,
                }}
              >
                <div className="font-mono font-bold tabular-nums text-foreground">
                  {formatAmount(hoverPoint.marketCap)}
                </div>
                <div className="text-muted tabular-nums">
                  T{hoverPoint.turn}
                  {newestTurnDate &&
                    ` · ${turnToRealDate(
                      hoverPoint.turn,
                      chartData[chartData.length - 1].turn,
                      newestTurnDate
                    )
                      .toISOString()
                      .slice(0, 10)}`}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return <div className="mb-8">{renderChart()}</div>;
}
