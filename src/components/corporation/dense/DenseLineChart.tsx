"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface LineSeries {
  label: string;
  values: number[];
  /** Text colour class for the stroke (the line uses currentColor). */
  tone: string;
  dashed?: boolean;
}

const PAD_LEFT = 64;
const PAD_RIGHT = 12;
const PAD_TOP = 10;
const PAD_BOTTOM = 22;

/**
 * Turn-indexed line chart for the corporation page. It measures its container
 * and draws at that width, so axis text stays at its real size instead of
 * being scaled with a fixed viewBox. Lines only: no area fill, no glow.
 */
export function DenseLineChart({
  turns,
  series,
  formatTick,
  height = 220,
  domain,
  marker,
  tooltip,
  ariaLabel,
}: {
  /** Turn number of each point; every series has one value per turn. */
  turns: number[];
  series: LineSeries[];
  formatTick: (value: number) => string;
  height?: number;
  /** Fixed y range for a bounded scale (a 0 to 100 score); otherwise fitted to the data. */
  domain?: [number, number];
  /** Labelled vertical rule at one point index (a basis change, an event). */
  marker?: { index: number; label: string } | null;
  /** Readout for the point under the pointer. */
  tooltip?: (index: number) => ReactNode;
  ariaLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = turns.length;
  const innerW = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
  const innerH = height - PAD_TOP - PAD_BOTTOM;
  const all = series.flatMap((s) => s.values);
  const minVal = all.length ? Math.min(...all) : 0;
  const maxVal = all.length ? Math.max(...all) : 1;
  const range = maxVal - minVal || 1;
  // Non-negative data (prices, counts, shares) never pads below zero.
  const yMin = domain
    ? domain[0]
    : minVal >= 0
      ? Math.max(0, minVal - range * 0.05)
      : minVal - range * 0.05;
  const yMax = domain ? domain[1] : maxVal + range * 0.05;
  const yRange = yMax - yMin || 1;

  const toX = (i: number) => (n <= 1 ? PAD_LEFT + innerW / 2 : PAD_LEFT + (i / (n - 1)) * innerW);
  const toY = (v: number) => PAD_TOP + ((yMax - v) / yRange) * innerH;

  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (yRange * i) / 4);
  const labelCount = Math.max(2, Math.min(n, Math.floor(innerW / 90)));
  const xLabels =
    n <= labelCount
      ? turns.map((_, i) => i)
      : Array.from({ length: labelCount }, (_, k) => Math.round((k * (n - 1)) / (labelCount - 1)));

  const active = hovered != null && hovered < n ? hovered : null;
  const pickIndex = (clientX: number, rect: DOMRect) => {
    if (n === 0) return null;
    const x = ((clientX - rect.left) / rect.width) * width;
    const t = n <= 1 ? 0 : (x - PAD_LEFT) / innerW;
    return Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))));
  };

  const activeX = active != null ? toX(active) : null;
  const markerX = marker && marker.index > 0 && marker.index < n ? toX(marker.index) : null;

  return (
    <div ref={wrapRef} className="relative min-w-0 select-none">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block max-w-full"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(e) =>
          setHovered(pickIndex(e.clientX, e.currentTarget.getBoundingClientRect()))
        }
        onPointerLeave={() => setHovered(null)}
      >
        {yTicks.map((tick, i) => {
          const y = toY(tick);
          return (
            <g key={i}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={width - PAD_RIGHT}
                y2={y}
                stroke="currentColor"
                strokeWidth={1}
                className="text-card-border"
                strokeDasharray={i === 0 ? undefined : "2 3"}
              />
              <text
                x={PAD_LEFT - 6}
                y={y + 3.5}
                textAnchor="end"
                fontSize={10}
                className="fill-muted font-mono"
              >
                {formatTick(tick)}
              </text>
            </g>
          );
        })}

        {markerX != null && marker && (
          <g className="text-warning">
            <line
              x1={markerX}
              y1={PAD_TOP}
              x2={markerX}
              y2={PAD_TOP + innerH}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text x={markerX + 4} y={PAD_TOP + 10} fontSize={10} fill="currentColor">
              {marker.label}
            </text>
          </g>
        )}

        {series.map((s, si) => (
          <polyline
            key={s.label}
            points={s.values.map((v, i) => `${toX(i)},${toY(v)}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={si === 0 ? 1.75 : 1.5}
            strokeDasharray={s.dashed ? "5 3" : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
            className={s.tone}
          />
        ))}

        {activeX != null && active != null && (
          <g>
            <line
              x1={activeX}
              y1={PAD_TOP}
              x2={activeX}
              y2={PAD_TOP + innerH}
              stroke="currentColor"
              strokeWidth={1}
              className="text-muted"
            />
            {series.map((s) =>
              s.values[active] != null ? (
                <circle
                  key={s.label}
                  cx={activeX}
                  cy={toY(s.values[active])}
                  r={3}
                  fill="currentColor"
                  className={s.tone}
                />
              ) : null
            )}
          </g>
        )}

        {xLabels.map((i) => (
          <text
            key={i}
            x={toX(i)}
            y={height - 6}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            fontSize={10}
            className="fill-muted font-mono"
          >
            T{turns[i]}
          </text>
        ))}
      </svg>

      {active != null && tooltip && activeX != null && (
        <div
          className="pointer-events-none absolute top-1 space-y-0.5 rounded-md border border-card-border bg-card px-2 py-1.5 text-xs shadow-card"
          style={activeX > width / 2 ? { left: PAD_LEFT + 4 } : { right: PAD_RIGHT + 4 }}
        >
          <div className="font-mono text-muted">Turn {turns[active]}</div>
          {tooltip(active)}
        </div>
      )}

      {series.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <svg width="16" height="6" aria-hidden className={s.tone}>
                <line
                  x1="0"
                  y1="3"
                  x2="16"
                  y2="3"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  strokeDasharray={s.dashed ? "5 3" : undefined}
                />
              </svg>
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
