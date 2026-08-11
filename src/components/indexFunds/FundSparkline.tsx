"use client";

import type { FundNavPoint } from "./types";

/** Mini NAV trend chart (same visual language as forex sparklines). */
export function FundSparkline({ history }: { history: FundNavPoint[] }) {
  if (history.length < 2) {
    return <span className="text-muted text-[10px] italic">No data</span>;
  }
  const values = history.map((h) => h.quotedNav);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 80;
  const height = 24;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");
  const isUp = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} className="inline-block" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={isUp ? "var(--color-success)" : "var(--color-error)"}
        strokeWidth="1.5"
      />
    </svg>
  );
}
