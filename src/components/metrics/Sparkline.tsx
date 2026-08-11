"use client";

import { useId } from "react";

interface SparklineProps {
  data: number[];
  w?: number;
  h?: number;
  /** Stroke/fill color; defaults to the masthead accent var. */
  color?: string;
  /** Whether to draw the soft area fill under the line. */
  fill?: boolean;
}

/** Small trend line with an optional gradient area fill. */
export function Sparkline({ data, w = 132, h = 34, color, fill = true }: SparklineProps) {
  const id = useId().replace(/:/g, "");
  if (data.length === 0) return <svg width={w} height={h} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const col = color || "var(--stat, var(--primary))";
  const pts = data.map(
    (v, i) =>
      [(i / (data.length - 1 || 1)) * w, h - ((v - min) / span) * (h - 4) - 2] as [number, number]
  );
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.26" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <polygon points={area} fill={`url(#${id})`} />}
      <polyline
        points={line}
        fill="none"
        stroke={col}
        strokeWidth="1.7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2.3" fill={col} />
    </svg>
  );
}

export default Sparkline;
