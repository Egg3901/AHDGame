"use client";

import { useId } from "react";
import type { HistoryPoint } from "../../types";

const CHART_WIDTH = 700;
const CHART_HEIGHT = 260;
const PAD = { top: 24, right: 24, bottom: 40, left: 64 };

interface PriceChartProps {
  history: HistoryPoint[];
  basePrice: number;
}

export default function PriceChart({ history, basePrice }: PriceChartProps) {
  const rawId = useId();
  const gradId = `pc-${rawId.replace(/:/g, "")}`;

  const innerW = CHART_WIDTH - PAD.left - PAD.right;
  const innerH = CHART_HEIGHT - PAD.top - PAD.bottom;

  const prices = history.map((h) => h.price);
  const turns = history.map((h) => h.turn);
  const minTurn = turns[0];
  const maxTurn = turns[turns.length - 1];
  const minPrice = Math.min(...prices, basePrice * 0.95);
  const maxPrice = Math.max(...prices, basePrice * 1.05);
  const pricePad = (maxPrice - minPrice) * 0.1 || basePrice * 0.05;
  const yMin = minPrice - pricePad;
  const yMax = maxPrice + pricePad;

  const xScale = (turn: number) =>
    PAD.left + ((turn - minTurn) / Math.max(maxTurn - minTurn, 1)) * innerW;
  const yScale = (val: number) => PAD.top + innerH - ((val - yMin) / (yMax - yMin)) * innerH;

  // Price line path
  const pricePath = history
    .map(
      (h, i) => `${i === 0 ? "M" : "L"} ${xScale(h.turn).toFixed(1)} ${yScale(h.price).toFixed(1)}`
    )
    .join(" ");

  // Area fill under price line
  const areaPath =
    pricePath +
    ` L ${xScale(history[history.length - 1].turn).toFixed(1)} ${(PAD.top + innerH).toFixed(1)}` +
    ` L ${xScale(history[0].turn).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`;

  // Y-axis ticks
  const yTicks = 5;
  const yTickVals = Array.from(
    { length: yTicks + 1 },
    (_, i) => yMin + (i / yTicks) * (yMax - yMin)
  );

  // Base price line position
  const basePriceY = yScale(basePrice);

  // Current price
  const currentPrice = history[history.length - 1].price;
  // For commodities: price above base = shortage = bad (red), below base = oversupply = good (green)
  const isAboveBase = currentPrice >= basePrice;
  const lineColor = isAboveBase ? "#ef4444" : "#22c55e";

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="w-full"
      style={{ maxHeight: CHART_HEIGHT }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.15" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yTickVals.map((yv, i) => (
        <line
          key={i}
          x1={PAD.left}
          x2={PAD.left + innerW}
          y1={yScale(yv)}
          y2={yScale(yv)}
          stroke="currentColor"
          strokeOpacity="0.07"
          strokeWidth="1"
        />
      ))}

      {/* Base price reference line */}
      <line
        x1={PAD.left}
        x2={PAD.left + innerW}
        y1={basePriceY}
        y2={basePriceY}
        stroke="#6b7280"
        strokeOpacity="0.4"
        strokeWidth="1"
        strokeDasharray="6 4"
      />
      <text
        x={PAD.left + innerW + 2}
        y={basePriceY + 3}
        fontSize="8"
        fill="#6b7280"
        fillOpacity="0.7"
      >
        Base
      </text>

      {/* Area under price line */}
      <path d={areaPath} fill={`url(#${gradId})`} />

      {/* Price line */}
      <path
        d={pricePath}
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Current price dot */}
      <circle
        cx={xScale(history[history.length - 1].turn)}
        cy={yScale(currentPrice)}
        r="4"
        fill={lineColor}
      />
      <circle
        cx={xScale(history[history.length - 1].turn)}
        cy={yScale(currentPrice)}
        r="8"
        fill={lineColor}
        fillOpacity="0.15"
      />

      {/* Y-axis labels */}
      {yTickVals.map((yv, i) => (
        <text
          key={i}
          x={PAD.left - 6}
          y={yScale(yv) + 4}
          textAnchor="end"
          fontSize="9"
          fill="currentColor"
          fillOpacity="0.4"
        >
          ${Math.round(yv).toLocaleString("en-US")}
        </text>
      ))}

      {/* X-axis turn labels */}
      {(() => {
        const turnRange = maxTurn - minTurn;
        const step = Math.max(1, Math.floor(turnRange / 6));
        const labels: number[] = [];
        for (let t = minTurn; t <= maxTurn; t += step) labels.push(t);
        if (labels[labels.length - 1] !== maxTurn) labels.push(maxTurn);
        return labels.map((t) => (
          <text
            key={t}
            x={xScale(t)}
            y={PAD.top + innerH + 16}
            textAnchor="middle"
            fontSize="9"
            fill="currentColor"
            fillOpacity="0.4"
          >
            T{t}
          </text>
        ));
      })()}

      {/* Current price label */}
      <text
        x={xScale(history[history.length - 1].turn)}
        y={yScale(currentPrice) - 10}
        textAnchor="middle"
        fontSize="10"
        fill={lineColor}
        fontWeight="bold"
      >
        ${currentPrice.toLocaleString("en-US")}
      </text>
    </svg>
  );
}
