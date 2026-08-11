"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatFundsCompact } from "@/lib/utils/formatters";

interface HistoryPoint {
  turn: number;
  totalValue: number;
  netValue?: number;
  stockValue?: number;
  bondValue?: number;
  cashValue?: number;
  liquidCashValue?: number;
  savingsCashValue?: number;
  /** FX rates captured at snapshot time; chart converts each point with its own
   *  rate so a floating ₳/local rate doesn't paint phantom volatility. */
  exchangeRatesSnapshot?: Partial<Record<CurrencyCode, number>>;
}

interface Props {
  history: HistoryPoint[];
  view?: "total" | "stocks" | "bonds" | "cash" | "savings";
}

const WIDTH = 600;
const HEIGHT = 180;
const PAD_LEFT = 56;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;
const INNER_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const INNER_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

const COLORS = {
  total: "var(--color-primary, #6366f1)",
  stocks: "var(--color-success, #22c55e)",
  bonds: "var(--color-warning, #f59e0b)",
  cash: "var(--color-info, #3b82f6)",
  savings: "var(--color-primary, #8b5cf6)",
};

export function PortfolioChart({ history, view = "total" }: Props) {
  const { resolveDisplayAt } = useCurrency();
  const [hovered, setHovered] = useState<number | null>(null);

  if (history.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-muted">
        Not enough data yet — check back after the next turn.
      </div>
    );
  }

  const getAnchor = (p: HistoryPoint): number => {
    if (view === "stocks") return p.stockValue ?? 0;
    if (view === "bonds") return p.bondValue ?? 0;
    if (view === "cash") return p.cashValue ?? 0;
    if (view === "savings") return p.savingsCashValue ?? 0;
    return p.netValue ?? p.totalValue;
  };

  // Convert each anchor value through its own snapshot rate so a moving ₳/local
  // rate doesn't repaint historical points. resolveDisplayAt falls back to live
  // rates when the snapshot is missing (pre-fix history).
  const displays = history.map((p) => resolveDisplayAt(getAnchor(p), p.exchangeRatesSnapshot));
  const values = displays.map((d) => d.value);
  const symbol = displays[displays.length - 1]?.symbol ?? "₳";
  const fmt = (v: number) => formatFundsCompact(Math.round(v), symbol);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  function toX(i: number): number {
    if (history.length <= 1) return PAD_LEFT + INNER_W / 2;
    return PAD_LEFT + (i / (history.length - 1)) * INNER_W;
  }

  function toY(value: number): number {
    return PAD_TOP + ((maxVal - value) / range) * INNER_H;
  }

  const points = history.map((p, i) => ({
    x: toX(i),
    y: toY(values[i]),
    displayValue: values[i],
    ...p,
  }));

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const color = COLORS[view];

  // Y-axis: 5 labels from min to max
  const yLabels = Array.from({ length: 5 }, (_, i) => minVal + (range * i) / 4);

  // X-axis: up to 5 evenly spaced turn labels
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

  return (
    <div className="relative select-none">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        style={{ height: HEIGHT }}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Y-axis grid + labels */}
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
                strokeDasharray={i === 0 || i === 4 ? undefined : "4 3"}
                className="text-card-border/60"
                opacity={0.4}
              />
              <text
                x={PAD_LEFT - 4}
                y={y + 4}
                textAnchor="end"
                fontSize={9}
                className="fill-muted/70"
              >
                {fmt(v)}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <defs>
          <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon
          points={`${points[0].x},${PAD_TOP + INNER_H} ${polyline} ${points[points.length - 1].x},${PAD_TOP + INNER_H}`}
          fill="url(#portfolioGrad)"
        />

        {/* Main line */}
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
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
              stroke={color}
              strokeWidth={1}
              strokeDasharray="3 2"
              opacity={0.6}
            />
            <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={4} fill={color} />
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
            T{history[i].turn}
          </text>
        ))}
      </svg>

      {/* Tooltip */}
      {hoveredPoint && (
        <div className="pointer-events-none absolute top-2 right-3 rounded-md border border-card-border bg-card px-2.5 py-1.5 text-xs shadow-card">
          <span className="text-muted">Turn {hoveredPoint.turn} · </span>
          <span className="font-semibold tabular-nums" style={{ color }}>
            {fmt(hoveredPoint.displayValue)}
          </span>
        </div>
      )}
    </div>
  );
}
