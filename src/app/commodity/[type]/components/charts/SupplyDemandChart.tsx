"use client";

import { useId } from "react";
import { formatUnits } from "../../lib/helpers";
import type { HistoryPoint } from "../../types";

const CHART_WIDTH = 700;
const CHART_HEIGHT = 260;
const PAD = { top: 24, right: 24, bottom: 40, left: 64 };

interface SupplyDemandChartProps {
  history: HistoryPoint[];
  unit: string;
}

export default function SupplyDemandChart({ history, unit }: SupplyDemandChartProps) {
  const rawId = useId();
  const supplyGradId = `sd-s-${rawId.replace(/:/g, "")}`;
  const demandGradId = `sd-d-${rawId.replace(/:/g, "")}`;

  const innerW = CHART_WIDTH - PAD.left - PAD.right;
  const innerH = CHART_HEIGHT - PAD.top - PAD.bottom;

  const turns = history.map((h) => h.turn);
  const minTurn = turns[0];
  const maxTurn = turns[turns.length - 1];

  const allValues = [...history.map((h) => h.supply), ...history.map((h) => h.demand)];
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const rangePad = (maxVal - minVal) * 0.12 || maxVal * 0.1 || 1;
  const yMin = Math.max(0, minVal - rangePad);
  const yMax = maxVal + rangePad;

  const xScale = (turn: number) =>
    PAD.left + ((turn - minTurn) / Math.max(maxTurn - minTurn, 1)) * innerW;
  const yScale = (val: number) => PAD.top + innerH - ((val - yMin) / (yMax - yMin)) * innerH;

  const supplyPath = history
    .map(
      (h, i) => `${i === 0 ? "M" : "L"} ${xScale(h.turn).toFixed(1)} ${yScale(h.supply).toFixed(1)}`
    )
    .join(" ");
  const demandPath = history
    .map(
      (h, i) => `${i === 0 ? "M" : "L"} ${xScale(h.turn).toFixed(1)} ${yScale(h.demand).toFixed(1)}`
    )
    .join(" ");

  const supplyAreaPath =
    supplyPath +
    ` L ${xScale(history[history.length - 1].turn).toFixed(1)} ${(PAD.top + innerH).toFixed(1)}` +
    ` L ${xScale(history[0].turn).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`;
  const demandAreaPath =
    demandPath +
    ` L ${xScale(history[history.length - 1].turn).toFixed(1)} ${(PAD.top + innerH).toFixed(1)}` +
    ` L ${xScale(history[0].turn).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`;

  const yTicks = 5;
  const yTickVals = Array.from(
    { length: yTicks + 1 },
    (_, i) => yMin + (i / yTicks) * (yMax - yMin)
  );

  const latestSupply = history[history.length - 1].supply;
  const latestDemand = history[history.length - 1].demand;

  return (
    <div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full"
        style={{ maxHeight: CHART_HEIGHT }}
      >
        <defs>
          <linearGradient id={supplyGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={demandGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.02" />
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

        {/* Supply area + line */}
        <path d={supplyAreaPath} fill={`url(#${supplyGradId})`} />
        <path
          d={supplyPath}
          fill="none"
          stroke="#22c55e"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Demand area + line */}
        <path d={demandAreaPath} fill={`url(#${demandGradId})`} />
        <path
          d={demandPath}
          fill="none"
          stroke="#ef4444"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="5 3"
        />

        {/* Latest supply dot + label */}
        <circle
          cx={xScale(history[history.length - 1].turn)}
          cy={yScale(latestSupply)}
          r="4"
          fill="#22c55e"
        />
        <text
          x={xScale(history[history.length - 1].turn) - 6}
          y={yScale(latestSupply) - 8}
          textAnchor="end"
          fontSize="9"
          fill="#22c55e"
          fontWeight="bold"
        >
          {formatUnits(latestSupply, unit)}
        </text>

        {/* Latest demand dot + label */}
        <circle
          cx={xScale(history[history.length - 1].turn)}
          cy={yScale(latestDemand)}
          r="4"
          fill="#ef4444"
        />
        <text
          x={xScale(history[history.length - 1].turn) - 6}
          y={yScale(latestDemand) + 14}
          textAnchor="end"
          fontSize="9"
          fill="#ef4444"
          fontWeight="bold"
        >
          {formatUnits(latestDemand, unit)}
        </text>

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
            {formatUnits(yv, unit)}
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
      </svg>
      {/* Legend */}
      <div className="flex items-center gap-4 mt-1 justify-center">
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-6 rounded-full bg-success/70" />
          <span className="text-xs text-muted">Supply</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-0 w-6 border-t-2 border-dashed border-error/70" />
          <span className="text-xs text-muted">Demand</span>
        </div>
      </div>
    </div>
  );
}
