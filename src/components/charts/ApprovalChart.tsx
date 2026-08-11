"use client";

import { useState } from "react";

interface HistoryPoint {
  turn: number;
  approval: number;
  net: number;
}

interface Props {
  history: HistoryPoint[];
}

const WIDTH = 600;
const HEIGHT = 160;
const PAD_LEFT = 36;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;
const INNER_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const INNER_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

function toX(i: number, total: number): number {
  if (total <= 1) return PAD_LEFT + INNER_W / 2;
  return PAD_LEFT + (i / (total - 1)) * INNER_W;
}

function toY(value: number): number {
  // y=0 is top in SVG; approval 100 → PAD_TOP, 0 → PAD_TOP + INNER_H
  return PAD_TOP + ((100 - value) / 100) * INNER_H;
}

function lineColor(approval: number): string {
  if (approval >= 50) return "var(--color-success, #22c55e)";
  if (approval >= 40) return "var(--color-warning, #f59e0b)";
  return "var(--color-error, #ef4444)";
}

export function ApprovalChart({ history }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (history.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-muted">
        Not enough data yet — check back after the next turn.
      </div>
    );
  }

  const points = history.map((p, i) => ({
    x: toX(i, history.length),
    y: toY(p.approval),
    ...p,
  }));

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const latest = history[history.length - 1].approval;
  const color = lineColor(latest);

  // Reference lines at 40 and 50
  const refLines = [
    { value: 50, label: "50", dashed: false },
    { value: 40, label: "40", dashed: true },
  ];

  // Y-axis labels
  const yLabels = [0, 25, 50, 75, 100];

  // X-axis: show up to 5 evenly spaced turn labels
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
        {/* Reference lines */}
        {refLines.map(({ value, label, dashed }) => {
          const y = toY(value);
          return (
            <g key={value}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={WIDTH - PAD_RIGHT}
                y2={y}
                stroke="currentColor"
                strokeWidth={1}
                strokeDasharray={dashed ? "4 3" : undefined}
                className="text-card-border/60"
                opacity={0.6}
              />
              <text x={PAD_LEFT - 4} y={y + 4} textAnchor="end" fontSize={9} className="fill-muted">
                {label}
              </text>
            </g>
          );
        })}

        {/* Y-axis labels */}
        {yLabels
          .filter((v) => v !== 50 && v !== 40)
          .map((v) => (
            <text
              key={v}
              x={PAD_LEFT - 4}
              y={toY(v) + 4}
              textAnchor="end"
              fontSize={9}
              className="fill-muted/60"
            >
              {v}
            </text>
          ))}

        {/* Area fill under line */}
        <defs>
          <linearGradient id="approvalGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon
          points={`${points[0].x},${PAD_TOP + INNER_H} ${polyline} ${points[points.length - 1].x},${PAD_TOP + INNER_H}`}
          fill="url(#approvalGrad)"
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

        {/* Hover hit targets — invisible wide bands per segment */}
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
            {hoveredPoint.approval.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}
