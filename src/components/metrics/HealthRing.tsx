"use client";

import { scoreColor } from "./scoreColor";

interface HealthRingProps {
  /** 0–100 score. */
  score: number;
  /** Outer diameter in px. */
  size?: number;
  /** Ring stroke width in px. */
  stroke?: number;
  /** Optional caption under the number (e.g. "avg", "/100"). */
  label?: string;
}

/** Donut score ring — colored by score via {@link scoreColor}. */
export function HealthRing({ score, size = 56, stroke = 6, label }: HealthRingProps) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const hex = scoreColor(score);
  const clamped = Math.max(0, Math.min(100, score));
  const off = circ * (1 - clamped / 100);
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--card-muted)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={hex}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={off}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-bold leading-none tabular-nums"
          style={{ color: hex, fontSize: size * 0.3 }}
        >
          {Math.round(clamped)}
        </span>
        {label && (
          <span className="text-muted" style={{ fontSize: size * 0.13 }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

export default HealthRing;
