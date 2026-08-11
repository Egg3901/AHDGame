"use client";

import { scoreColor } from "./scoreColor";

interface ScoreBadgeProps {
  /** 0–100 score. */
  score: number;
  /** Tier label (e.g. from `getMetricBadge(score).label`). */
  label?: string;
  className?: string;
}

/** Compact score chip, colored by score. */
export function ScoreBadge({ score, label, className = "" }: ScoreBadgeProps) {
  const hex = scoreColor(score);
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${className}`}
      style={{ borderColor: hex + "66", background: hex + "1f", color: hex }}
    >
      <span className="tabular-nums">{Math.round(score)}</span>
      {label && <span className="opacity-80">{label}</span>}
    </span>
  );
}

export default ScoreBadge;
