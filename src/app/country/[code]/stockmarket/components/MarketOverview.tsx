"use client";

import { useState, useMemo, useRef, useId, useEffect } from "react";
import { Skeleton } from "@/components/ui";
import { getExchangeApiKey, getExchangeLabel } from "@/lib/constants/exchangeRegistry";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import { fetchJson } from "@/lib/observability/fetchJson";
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

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "24h": "24h · 6m",
  "48h": "48h · 1y",
  "5y": "5y",
  all: "All",
};

const TIMEFRAME_FETCH_LIMIT: Record<Timeframe, number> = {
  "24h": 24,
  "48h": 48,
  "5y": 240,
  all: 2000,
};

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

export function MarketOverview({ exchangeFilter }: { exchangeFilter: ExchangeFilter }) {
  const { formatAmount } = useCurrency();
  // Preset-aware year axis. Falls back to STARTING_YEAR if status not yet loaded.
  const turnStatus = useGameTurnStatus();
  const startingYearRef = turnStatus?.startingYear ?? STARTING_YEAR;
  const calendarOffset = turnStatus?.preIterationTurns ?? 0;
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [timeframe, setTimeframe] = useState<Timeframe>("48h");
  const [animDir, setAnimDir] = useState<"compress" | "expand" | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const prevTfRef = useRef<Timeframe>("48h");
  const rawId = useId();
  const gradId = `mc-${rawId.replace(/:/g, "")}`;

  const [history, setHistory] = useState<MarketCapPoint[]>([]);
  const [newestTurnDate, setNewestTurnDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const exchange =
      exchangeFilter === "global" ? "global" : (getExchangeApiKey(exchangeFilter) ?? "global");
    fetchJson<{ points?: MarketCapPoint[]; newestTurnDate?: string | null }>(
      `/api/stock-exchange/market-cap-history?exchange=${exchange}&limit=${TIMEFRAME_FETCH_LIMIT[timeframe]}`,
      { cache: "no-store", feature: "market-cap-history" }
    )
      .then((data) => {
        if (cancelled || !data) return;
        setHistory(data.points ?? []);
        setNewestTurnDate(data.newestTurnDate ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [exchangeFilter, timeframe]);

  const handleTimeframeChange = (tf: Timeframe) => {
    if (tf === timeframe) return;
    const goingLonger = TIMEFRAME_ORDER[tf] > TIMEFRAME_ORDER[prevTfRef.current];
    prevTfRef.current = tf;
    setAnimDir(goingLonger ? "expand" : "compress");
    setAnimKey((k) => k + 1);
    setTimeframe(tf);
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
    const limit = TIMEFRAME_TURNS[timeframe];
    const raw = limit === Infinity ? history : history.slice(-limit);
    // For "all", downsample to ~200 visible points so the SVG stays fast
    if (timeframe === "all" && raw.length > 200) {
      const step = Math.ceil(raw.length / 200);
      return raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
    }
    return raw;
  }, [history, timeframe]);

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
    const minCap = Math.min(...caps);
    const maxCap = Math.max(...caps);
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
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted">
              {exchangeLabel} Market Index
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
              {(["24h", "48h", "5y", "all"] as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  onClick={() => handleTimeframeChange(tf)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                    timeframe === tf
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "bg-card-elevated border-card-border text-muted hover:text-foreground hover:bg-card-elevated/80"
                  }`}
                >
                  {TIMEFRAME_LABELS[tf]}
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
          <svg
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
              timeframe !== "24h" &&
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
                  const nextX = visible.length > 0 ? xScale(visible[visible.length - 1]) : Infinity;
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
              timeframe === "24h" &&
              (() => {
                const newestTurn = chartData[chartData.length - 1].turn;
                const tickCount = 4;
                const step = Math.max(1, Math.floor(chartData.length / tickCount));
                const tickTurns: number[] = [];
                for (let i = 0; i < chartData.length; i += step) tickTurns.push(chartData[i].turn);
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
        </div>
      </div>
    );
  };

  return <div className="mb-8">{renderChart()}</div>;
}
