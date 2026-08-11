"use client";

import { useState, useMemo } from "react";

export type TrendSeries = "rate" | "inflation" | "gdpGrowth" | "savings";

interface DataPoint {
  turn: number;
  rate: number;
}

interface Props {
  interestRateHistory: DataPoint[];
  inflationHistory: DataPoint[];
  gdpGrowthHistory: DataPoint[];
  savingsFlowHistory?: DataPoint[];
  /** Which series to show initially */
  defaultSeries?: TrendSeries;
}

const SERIES_CONFIG: Record<
  TrendSeries,
  { label: string; color: string; unit: string; refLine?: number }
> = {
  rate: {
    label: "Interest Rate",
    color: "var(--color-primary, #ef4444)",
    unit: "%",
    refLine: 3.0,
  },
  inflation: {
    label: "Inflation",
    color: "var(--color-warning, #f59e0b)",
    unit: "%",
    refLine: 2.0,
  },
  gdpGrowth: {
    label: "GDP Growth",
    color: "var(--color-success, #22c55e)",
    unit: "%",
    refLine: 0,
  },
  savings: {
    label: "Savings Flow",
    color: "var(--color-secondary, #06b6d4)",
    unit: "%",
    refLine: 0,
  },
};

const WIDTH = 600;
const HEIGHT = 180;
const PAD_LEFT = 40;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;
const INNER_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const INNER_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

function inflationAtOrBefore(sorted: DataPoint[], turn: number): number {
  let last = 0;
  for (const p of sorted) {
    if (p.turn <= turn) last = p.rate;
    else break;
  }
  return last;
}

function computeRealGdp(gdpData: DataPoint[], inflData: DataPoint[]): DataPoint[] {
  const inflMap = new Map(inflData.map((p) => [p.turn, p.rate]));
  const sortedInfl = [...inflData].sort((a, b) => a.turn - b.turn);
  return gdpData.map(({ turn, rate }) => {
    const infl = inflMap.get(turn) ?? inflationAtOrBefore(sortedInfl, turn);
    return { turn, rate: rate - infl };
  });
}

export function EconomicTrendsChart({
  interestRateHistory,
  inflationHistory,
  gdpGrowthHistory,
  savingsFlowHistory = [],
  defaultSeries = "rate",
}: Props) {
  const [activeSeries, setActiveSeries] = useState<TrendSeries>(defaultSeries);
  const [hovered, setHovered] = useState<number | null>(null);
  const [gdpMode, setGdpMode] = useState<"nominal" | "real">("nominal");
  const [view, setView] = useState<"chart" | "table">("chart");

  const realGdpData = useMemo(
    () => computeRealGdp(gdpGrowthHistory, inflationHistory),
    [gdpGrowthHistory, inflationHistory]
  );

  const dataMap: Record<TrendSeries, DataPoint[]> = {
    rate: interestRateHistory,
    inflation: inflationHistory,
    gdpGrowth: gdpMode === "nominal" ? gdpGrowthHistory : realGdpData,
    savings: savingsFlowHistory,
  };

  const data = dataMap[activeSeries];
  const config = SERIES_CONFIG[activeSeries];

  const controls = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <SeriesToggle active={activeSeries} onChange={setActiveSeries} dataMap={dataMap} />
        {activeSeries === "gdpGrowth" && <GdpModeToggle mode={gdpMode} onChange={setGdpMode} />}
      </div>
      <ViewToggle view={view} onChange={setView} />
    </div>
  );

  if (!data || data.length < 2) {
    return (
      <div>
        {controls}
        <div className="flex h-24 items-center justify-center text-sm text-muted">
          Not enough data yet — check back after the next turn.
        </div>
      </div>
    );
  }

  if (view === "table") {
    return (
      <div>
        {controls}
        <SeriesTable
          data={data}
          config={config}
          activeSeries={activeSeries}
          gdpMode={gdpMode}
          nominalGdpData={gdpGrowthHistory}
          realGdpData={realGdpData}
        />
      </div>
    );
  }

  // Compute Y bounds with padding
  const values = data.map((d) => d.rate);
  let minVal = Math.min(...values);
  let maxVal = Math.max(...values);

  if (config.refLine !== undefined) {
    minVal = Math.min(minVal, config.refLine);
    maxVal = Math.max(maxVal, config.refLine);
  }

  const range = maxVal - minVal || 1;
  minVal = minVal - range * 0.1;
  maxVal = maxVal + range * 0.1;
  const yRange = maxVal - minVal;

  function toX(i: number): number {
    if (data.length <= 1) return PAD_LEFT + INNER_W / 2;
    return PAD_LEFT + (i / (data.length - 1)) * INNER_W;
  }

  function toY(value: number): number {
    return PAD_TOP + ((maxVal - value) / yRange) * INNER_H;
  }

  const points = data.map((d, i) => ({
    x: toX(i),
    y: toY(d.rate),
    ...d,
  }));

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  const yLabels: number[] = [];
  for (let i = 0; i <= 4; i++) {
    yLabels.push(minVal + (yRange * i) / 4);
  }

  const xLabelIndices: number[] = [];
  if (data.length <= 5) {
    data.forEach((_, i) => xLabelIndices.push(i));
  } else {
    const step = Math.floor((data.length - 1) / 4);
    for (let i = 0; i <= 4; i++) {
      xLabelIndices.push(Math.min(i * step, data.length - 1));
    }
    if (!xLabelIndices.includes(data.length - 1)) {
      xLabelIndices[xLabelIndices.length - 1] = data.length - 1;
    }
  }

  const hoveredPoint = hovered !== null ? points[hovered] : null;
  const gradientId = `econTrend-${activeSeries}-${gdpMode}`;

  return (
    <div>
      {controls}
      <div className="relative select-none mt-3">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          style={{ height: HEIGHT }}
          onMouseLeave={() => setHovered(null)}
        >
          {/* Y-axis grid lines + labels */}
          {yLabels.map((v, i) => {
            const y = toY(v);
            return (
              <g key={i}>
                <line
                  x1={PAD_LEFT}
                  y1={y}
                  x2={WIDTH - PAD_RIGHT}
                  y2={y}
                  stroke="currentColor"
                  strokeWidth={1}
                  className="text-card-border/40"
                />
                <text
                  x={PAD_LEFT - 4}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={9}
                  className="fill-muted/60"
                >
                  {v.toFixed(1)}
                </text>
              </g>
            );
          })}

          {/* Reference line */}
          {config.refLine !== undefined && (
            <g>
              <line
                x1={PAD_LEFT}
                y1={toY(config.refLine)}
                x2={WIDTH - PAD_RIGHT}
                y2={toY(config.refLine)}
                stroke={config.color}
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.5}
              />
              <text
                x={WIDTH - PAD_RIGHT + 2}
                y={toY(config.refLine) + 3}
                fontSize={8}
                className="fill-muted/50"
              >
                {config.refLine}%
              </text>
            </g>
          )}

          {/* Area fill */}
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={config.color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={config.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon
            points={`${points[0].x},${PAD_TOP + INNER_H} ${polyline} ${points[points.length - 1].x},${PAD_TOP + INNER_H}`}
            fill={`url(#${gradientId})`}
          />

          {/* Main line */}
          <polyline
            points={polyline}
            fill="none"
            stroke={config.color}
            strokeWidth={2}
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
                y={PAD_TOP}
                width={Math.max(hitW, 8)}
                height={INNER_H}
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
                y1={PAD_TOP}
                x2={hoveredPoint.x}
                y2={PAD_TOP + INNER_H}
                stroke={config.color}
                strokeWidth={1}
                strokeDasharray="3 2"
                opacity={0.6}
              />
              <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={4} fill={config.color} />
            </>
          )}

          {/* X-axis turn labels */}
          {xLabelIndices.map((i) => (
            <text
              key={i}
              x={points[i].x}
              y={HEIGHT - 6}
              textAnchor="middle"
              fontSize={9}
              className="fill-muted/70"
            >
              T{data[i].turn}
            </text>
          ))}
        </svg>

        {/* Tooltip */}
        {hoveredPoint && (
          <div className="pointer-events-none absolute top-2 right-3 rounded-md border border-card-border bg-card px-2.5 py-1.5 text-xs shadow-card">
            <span className="text-muted">Turn {hoveredPoint.turn} · </span>
            <span className="font-semibold tabular-nums" style={{ color: config.color }}>
              {hoveredPoint.rate.toFixed(2)}
              {config.unit}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function GdpModeToggle({
  mode,
  onChange,
}: {
  mode: "nominal" | "real";
  onChange: (m: "nominal" | "real") => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-card-border bg-card-muted p-0.5">
      {(["nominal", "real"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-all capitalize ${
            mode === m
              ? "bg-card text-foreground shadow-card border border-card-border"
              : "text-muted hover:text-foreground"
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: "chart" | "table";
  onChange: (v: "chart" | "table") => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-card-border bg-card-muted p-0.5">
      <button
        onClick={() => onChange("chart")}
        className={`rounded px-2.5 py-1 text-xs font-medium transition-all ${
          view === "chart"
            ? "bg-card text-foreground shadow-card border border-card-border"
            : "text-muted hover:text-foreground"
        }`}
      >
        Chart
      </button>
      <button
        onClick={() => onChange("table")}
        className={`rounded px-2.5 py-1 text-xs font-medium transition-all ${
          view === "table"
            ? "bg-card text-foreground shadow-card border border-card-border"
            : "text-muted hover:text-foreground"
        }`}
      >
        Table
      </button>
    </div>
  );
}

function SeriesTable({
  data,
  config,
  activeSeries,
  gdpMode,
  nominalGdpData,
  realGdpData,
}: {
  data: DataPoint[];
  config: { label: string; color: string; unit: string };
  activeSeries: TrendSeries;
  gdpMode: "nominal" | "real";
  nominalGdpData: DataPoint[];
  realGdpData: DataPoint[];
}) {
  const showBothGdp = activeSeries === "gdpGrowth";

  // Build lookup for the other GDP column
  const nominalMap = new Map(nominalGdpData.map((p) => [p.turn, p.rate]));
  const realMap = new Map(realGdpData.map((p) => [p.turn, p.rate]));

  const sorted = [...data].sort((a, b) => b.turn - a.turn);

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-card-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-card-border bg-card-muted">
            <th className="px-3 py-2 text-left font-medium text-muted">Turn</th>
            {showBothGdp ? (
              <>
                <th className="px-3 py-2 text-right font-medium text-muted">Nominal</th>
                <th className="px-3 py-2 text-right font-medium text-muted">Real</th>
              </>
            ) : (
              <th className="px-3 py-2 text-right font-medium text-muted">{config.label}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((point, i) => {
            const isEven = i % 2 === 0;
            return (
              <tr key={point.turn} className={isEven ? "bg-card" : "bg-card-muted/40"}>
                <td className="px-3 py-1.5 tabular-nums text-muted">T{point.turn}</td>
                {showBothGdp ? (
                  <>
                    <td
                      className="px-3 py-1.5 text-right tabular-nums font-medium"
                      style={{
                        color: gdpMode === "nominal" ? config.color : undefined,
                      }}
                    >
                      {(nominalMap.get(point.turn) ?? 0).toFixed(2)}%
                    </td>
                    <td
                      className="px-3 py-1.5 text-right tabular-nums font-medium"
                      style={{
                        color: gdpMode === "real" ? config.color : undefined,
                      }}
                    >
                      {(realMap.get(point.turn) ?? 0).toFixed(2)}%
                    </td>
                  </>
                ) : (
                  <td
                    className="px-3 py-1.5 text-right tabular-nums font-medium"
                    style={{ color: config.color }}
                  >
                    {point.rate.toFixed(2)}
                    {config.unit}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SeriesToggle({
  active,
  onChange,
  dataMap,
}: {
  active: TrendSeries;
  onChange: (s: TrendSeries) => void;
  dataMap: Record<TrendSeries, DataPoint[]>;
}) {
  const series: TrendSeries[] = ["rate", "inflation", "gdpGrowth", "savings"];
  return (
    <div className="flex gap-1.5">
      {series.map((s) => {
        const cfg = SERIES_CONFIG[s];
        const hasData = dataMap[s] && dataMap[s].length > 0;
        const isActive = active === s;
        return (
          <button
            key={s}
            onClick={() => onChange(s)}
            disabled={!hasData}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              isActive
                ? "bg-card-elevated text-foreground shadow-card border border-card-border"
                : hasData
                  ? "text-muted hover:text-foreground hover:bg-card-muted border border-transparent"
                  : "text-muted/30 cursor-not-allowed border border-transparent"
            }`}
          >
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full"
              style={{
                backgroundColor: isActive ? cfg.color : "transparent",
                border: `1.5px solid ${cfg.color}`,
                opacity: hasData ? 1 : 0.3,
              }}
            />
            {cfg.label}
          </button>
        );
      })}
    </div>
  );
}
