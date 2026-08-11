"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatFundsCompact } from "@/lib/utils/formatters";

interface HistoryPoint {
  turn: number;
  totalValue: number;
  stockValue?: number;
  bondValue?: number;
  cashValue?: number;
  /** FX rates captured at snapshot time. See PortfolioChart for rationale. */
  exchangeRatesSnapshot?: Partial<Record<CurrencyCode, number>>;
}

interface Props {
  history: HistoryPoint[];
  /** Corporate investment portfolios have no cash series in history snapshots. */
  hideCashSeries?: boolean;
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
  stocks: "var(--color-success, #22c55e)",
  bonds: "var(--color-warning, #f59e0b)",
  cash: "var(--color-info, #3b82f6)",
};

export function PortfolioBreakdownChart({ history, hideCashSeries = false }: Props) {
  const { resolveDisplayAt } = useCurrency();
  const [hovered, setHovered] = useState<number | null>(null);
  const [visibleSeries, setVisibleSeries] = useState({
    stocks: true,
    bonds: true,
    cash: !hideCashSeries,
  });

  if (history.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-muted">
        Not enough data yet — check back after the next turn.
      </div>
    );
  }

  // Convert each anchor value through its own snapshot rate (current rate when
  // pre-fix history points lack the snapshot). See PortfolioChart for rationale.
  const seriesByPoint = history.map((p) => {
    const snap = p.exchangeRatesSnapshot;
    return {
      stocks: p.stockValue !== undefined ? resolveDisplayAt(p.stockValue, snap).value : undefined,
      bonds: p.bondValue !== undefined ? resolveDisplayAt(p.bondValue, snap).value : undefined,
      cash: p.cashValue !== undefined ? resolveDisplayAt(p.cashValue, snap).value : undefined,
    };
  });
  const lastSymbol = resolveDisplayAt(0, history[history.length - 1]?.exchangeRatesSnapshot).symbol;
  const fmt = (v: number) => formatFundsCompact(Math.round(v), lastSymbol);

  // Calculate max value across all series for Y scale (in display currency)
  const allValues: number[] = [];
  seriesByPoint.forEach((p) => {
    if (visibleSeries.stocks && p.stocks !== undefined) allValues.push(p.stocks);
    if (visibleSeries.bonds && p.bonds !== undefined) allValues.push(p.bonds);
    if (visibleSeries.cash && p.cash !== undefined) allValues.push(p.cash);
  });

  if (allValues.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-muted">
        No data available for selected series.
      </div>
    );
  }

  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;

  function toX(i: number): number {
    if (history.length <= 1) return PAD_LEFT + INNER_W / 2;
    return PAD_LEFT + (i / (history.length - 1)) * INNER_W;
  }

  function toY(value: number): number {
    return PAD_TOP + ((maxVal - value) / range) * INNER_H;
  }

  // Build points for each series — use the snapshot-rate-converted values so
  // the curves track real local-currency value at each turn.
  const stockPoints = visibleSeries.stocks
    ? history.map((p, i) => ({
        x: toX(i),
        y: toY(seriesByPoint[i].stocks ?? 0),
        displayValue: seriesByPoint[i].stocks,
        ...p,
      }))
    : [];
  const bondPoints = visibleSeries.bonds
    ? history.map((p, i) => ({
        x: toX(i),
        y: toY(seriesByPoint[i].bonds ?? 0),
        displayValue: seriesByPoint[i].bonds,
        ...p,
      }))
    : [];
  const cashPoints = visibleSeries.cash
    ? history.map((p, i) => ({
        x: toX(i),
        y: toY(seriesByPoint[i].cash ?? 0),
        displayValue: seriesByPoint[i].cash,
        ...p,
      }))
    : [];

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

  const hoveredPoint = hovered !== null ? history[hovered] : null;

  return (
    <div className="relative select-none">
      {/* Legend */}
      <div className="flex items-center gap-4 mb-3">
        <button
          onClick={() => setVisibleSeries((s) => ({ ...s, stocks: !s.stocks }))}
          className={`flex items-center gap-1.5 text-xs transition-opacity ${
            visibleSeries.stocks ? "opacity-100" : "opacity-40"
          }`}
        >
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.stocks }} />
          <span className="text-muted">Stocks</span>
        </button>
        <button
          onClick={() => setVisibleSeries((s) => ({ ...s, bonds: !s.bonds }))}
          className={`flex items-center gap-1.5 text-xs transition-opacity ${
            visibleSeries.bonds ? "opacity-100" : "opacity-40"
          }`}
        >
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.bonds }} />
          <span className="text-muted">Bonds</span>
        </button>
        {!hideCashSeries && (
          <button
            onClick={() => setVisibleSeries((s) => ({ ...s, cash: !s.cash }))}
            className={`flex items-center gap-1.5 text-xs transition-opacity ${
              visibleSeries.cash ? "opacity-100" : "opacity-40"
            }`}
          >
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.cash }} />
            <span className="text-muted">Cash</span>
          </button>
        )}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        style={{ height: HEIGHT }}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Y-axis grid + labels */}
        {Array.from({ length: 5 }, (_, i) => {
          const v = minVal + (range * i) / 4;
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

        {/* Stock line */}
        {visibleSeries.stocks && stockPoints.length > 0 && (
          <>
            <polyline
              points={stockPoints.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={COLORS.stocks}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {hovered !== null && stockPoints[hovered] && (
              <circle
                cx={stockPoints[hovered].x}
                cy={stockPoints[hovered].y}
                r={4}
                fill={COLORS.stocks}
              />
            )}
          </>
        )}

        {/* Bond line */}
        {visibleSeries.bonds && bondPoints.length > 0 && (
          <>
            <polyline
              points={bondPoints.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={COLORS.bonds}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {hovered !== null && bondPoints[hovered] && (
              <circle
                cx={bondPoints[hovered].x}
                cy={bondPoints[hovered].y}
                r={4}
                fill={COLORS.bonds}
              />
            )}
          </>
        )}

        {/* Cash line */}
        {visibleSeries.cash && cashPoints.length > 0 && (
          <>
            <polyline
              points={cashPoints.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={COLORS.cash}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {hovered !== null && cashPoints[hovered] && (
              <circle
                cx={cashPoints[hovered].x}
                cy={cashPoints[hovered].y}
                r={4}
                fill={COLORS.cash}
              />
            )}
          </>
        )}

        {/* Hover crosshair */}
        {hovered !== null && history[hovered] && (
          <line
            x1={toX(hovered)}
            y1={PAD_TOP}
            x2={toX(hovered)}
            y2={PAD_TOP + INNER_H}
            stroke="var(--color-muted)"
            strokeWidth={1}
            strokeDasharray="3 2"
            opacity={0.6}
          />
        )}

        {/* Hover hit targets */}
        {history.map((_, i) => {
          const prevX = i > 0 ? toX(i - 1) : toX(i);
          const nextX = i < history.length - 1 ? toX(i + 1) : toX(i);
          const hitX = (prevX + toX(i)) / 2;
          const hitW = (nextX + toX(i)) / 2 - hitX;
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

        {/* X-axis turn labels */}
        {xLabelIndices.map((i) => (
          <text
            key={i}
            x={toX(i)}
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
      {hoveredPoint && hovered !== null && (
        <div className="pointer-events-none absolute top-2 right-3 rounded-md border border-card-border bg-card px-2.5 py-1.5 text-xs shadow-card">
          <div className="text-muted mb-1">Turn {hoveredPoint.turn}</div>
          {visibleSeries.stocks && seriesByPoint[hovered]?.stocks !== undefined && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.stocks }} />
                <span>Stocks</span>
              </span>
              <span className="font-semibold tabular-nums">
                {fmt(seriesByPoint[hovered].stocks!)}
              </span>
            </div>
          )}
          {visibleSeries.bonds && seriesByPoint[hovered]?.bonds !== undefined && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.bonds }} />
                <span>Bonds</span>
              </span>
              <span className="font-semibold tabular-nums">
                {fmt(seriesByPoint[hovered].bonds!)}
              </span>
            </div>
          )}
          {!hideCashSeries && visibleSeries.cash && seriesByPoint[hovered]?.cash !== undefined && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.cash }} />
                <span>Cash</span>
              </span>
              <span className="font-semibold tabular-nums">
                {fmt(seriesByPoint[hovered].cash!)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
