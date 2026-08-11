"use client";

import { useId } from "react";

// ─── SVG Chart ────────────────────────────────────────────────────────────────

const FORWARD_TURNS = 48;
const CHART_WIDTH = 600;
const CHART_HEIGHT = 220;
const PAD = { top: 24, right: 24, bottom: 40, left: 56 };

interface ChartPoint {
  x: number;
  y: number;
  turn: number;
  value: number;
  isProjection: boolean;
}

export function MetricChart({
  history,
  currentValue,
  tickRate,
  isHigherBetter,
  formatSuffix,
  decimals,
}: {
  history: Array<{ turn: number; value: number }>;
  currentValue: number;
  tickRate: number;
  isHigherBetter: boolean;
  formatSuffix: string;
  decimals: number;
}) {
  const rawId = useId();
  const hasHistory = history.length > 0;
  const lastTurn = history.length > 0 ? history[history.length - 1].turn : 0;

  // Build combined data: history + projection
  const allPoints: ChartPoint[] = [];

  if (hasHistory) {
    for (const h of history) {
      allPoints.push({ x: h.turn, y: h.value, turn: h.turn, value: h.value, isProjection: false });
    }
  } else {
    // No history yet: start "now" at turn 0
    allPoints.push({ x: 0, y: currentValue, turn: 0, value: currentValue, isProjection: false });
  }

  // Projection from current value
  let v = currentValue;
  for (let t = 1; t <= FORWARD_TURNS; t++) {
    v = Math.max(0, v + tickRate);
    allPoints.push({ x: lastTurn + t, y: v, turn: lastTurn + t, value: v, isProjection: true });
  }

  const xMin = allPoints[0].x;
  const xMax = allPoints[allPoints.length - 1].x;
  const allValues = allPoints.map((p) => p.y);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal;
  const yPad = range * 0.15 || Math.abs(currentValue) * 0.1 || 1;
  const yMin = minVal - yPad;
  const yMax = maxVal + yPad;

  const innerW = CHART_WIDTH - PAD.left - PAD.right;
  const innerH = CHART_HEIGHT - PAD.top - PAD.bottom;

  const xScale = (turn: number) => PAD.left + ((turn - xMin) / Math.max(xMax - xMin, 1)) * innerW;
  const yScale = (val: number) => PAD.top + innerH - ((val - yMin) / (yMax - yMin)) * innerH;

  const histPoints = allPoints.filter((p) => !p.isProjection);
  const projPoints = allPoints.filter((p) => p.isProjection);
  // Connect: last history point → first projection
  const connectorStart = histPoints[histPoints.length - 1] ?? projPoints[0];
  const projLine = [connectorStart, ...projPoints];

  const toPath = (pts: ChartPoint[]) =>
    pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`)
      .join(" ");

  const histPath = histPoints.length > 1 ? toPath(histPoints) : null;
  const projPath = projLine.length > 1 ? toPath(projLine) : null;

  const projAreaD = projPath
    ? projPath +
      ` L ${xScale(projLine[projLine.length - 1].x).toFixed(1)} ${(PAD.top + innerH).toFixed(1)}` +
      ` L ${xScale(projLine[0].x).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`
    : null;

  const isTrendGood = isHigherBetter ? tickRate >= 0 : tickRate <= 0;
  const trendColor = tickRate === 0 ? "#6b7280" : isTrendGood ? "#22c55e" : "#ef4444";
  const histColor = "#60a5fa"; // blue for actual history
  const gradId = `mg-${rawId.replace(/:/g, "")}`;

  // Y-axis ticks
  const yTicks = 4;
  const yTickVals = Array.from(
    { length: yTicks + 1 },
    (_, i) => yMin + (i / yTicks) * (yMax - yMin)
  );

  // X-axis: label "now" separator and a few turns
  const nowX = xScale(lastTurn);
  const fmt = (val: number) =>
    val.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }) + formatSuffix;

  const currentDot = { x: lastTurn, y: currentValue };

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="w-full"
      style={{ height: CHART_HEIGHT }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={trendColor} stopOpacity="0.2" />
          <stop offset="100%" stopColor={trendColor} stopOpacity="0.02" />
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

      {/* "Now" divider */}
      <line
        x1={nowX}
        x2={nowX}
        y1={PAD.top}
        y2={PAD.top + innerH}
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="1"
        strokeDasharray="4 3"
      />

      {/* History area */}
      {histPath && histPoints.length > 1 && (
        <path
          d={
            histPath +
            ` L ${xScale(histPoints[histPoints.length - 1].x).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} L ${xScale(histPoints[0].x).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`
          }
          fill={histColor}
          fillOpacity="0.08"
        />
      )}

      {/* History line */}
      {histPath && (
        <path
          d={histPath}
          fill="none"
          stroke={histColor}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* Projection area */}
      {projAreaD && <path d={projAreaD} fill={`url(#${gradId})`} />}

      {/* Projection line (dashed) */}
      {projPath && (
        <path
          d={projPath}
          fill="none"
          stroke={trendColor}
          strokeWidth="2"
          strokeDasharray="6 3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* Current value dot */}
      <circle cx={xScale(currentDot.x)} cy={yScale(currentDot.y)} r="5" fill={trendColor} />
      <circle
        cx={xScale(currentDot.x)}
        cy={yScale(currentDot.y)}
        r="10"
        fill={trendColor}
        fillOpacity="0.12"
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
          {fmt(yv)}
        </text>
      ))}

      {/* X-axis "Now" label */}
      <text
        x={nowX}
        y={PAD.top + innerH + 16}
        textAnchor="middle"
        fontSize="9"
        fill="currentColor"
        fillOpacity="0.5"
      >
        Now
      </text>

      {/* "+1yr" label */}
      <text
        x={xScale(lastTurn + FORWARD_TURNS)}
        y={PAD.top + innerH + 16}
        textAnchor="middle"
        fontSize="9"
        fill={trendColor}
        fillOpacity="0.7"
      >
        +1yr
      </text>

      {/* History label */}
      {hasHistory && (
        <text
          x={xScale(histPoints[0].x)}
          y={PAD.top + innerH + 16}
          textAnchor="middle"
          fontSize="9"
          fill={histColor}
          fillOpacity="0.6"
        >
          -{history.length}t
        </text>
      )}

      {/* Legend */}
      <g>
        <line
          x1={PAD.left}
          x2={PAD.left + 16}
          y1={PAD.top - 8}
          y2={PAD.top - 8}
          stroke={histColor}
          strokeWidth="2"
        />
        <text x={PAD.left + 20} y={PAD.top - 4} fontSize="9" fill={histColor} fillOpacity="0.8">
          Actual
        </text>
        <line
          x1={PAD.left + 60}
          x2={PAD.left + 76}
          y1={PAD.top - 8}
          y2={PAD.top - 8}
          stroke={trendColor}
          strokeWidth="2"
          strokeDasharray="4 2"
        />
        <text x={PAD.left + 80} y={PAD.top - 4} fontSize="9" fill={trendColor} fillOpacity="0.8">
          Projected
        </text>
      </g>
    </svg>
  );
}
