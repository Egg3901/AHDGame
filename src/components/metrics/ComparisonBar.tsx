"use client";

interface ComparisonBarProps {
  /** This region's value. */
  value: number;
  /** National average (center marker). */
  avg: number;
  /** Whether a higher value is better (decides good/bad coloring). */
  isHigherBetter: boolean;
}

/** Horizontal bar: region value vs national average, with a center marker at avg. */
export function ComparisonBar({ value, avg, isHigherBetter }: ComparisonBarProps) {
  const ratio = avg !== 0 ? value / avg : 1;
  const width = Math.min(100, Math.max(0, ratio * 50));
  const diffPct = avg !== 0 ? ((value - avg) / avg) * 100 : 0;
  const good = isHigherBetter ? value > avg : value < avg;
  const neutral = Math.abs(diffPct) < 2;
  const col = neutral ? "bg-muted" : good ? "bg-success" : "bg-error";
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-card-muted">
      <div className="absolute left-1/2 top-0 z-10 h-full w-0.5 -translate-x-1/2 bg-muted/70" />
      <div
        className={`h-full rounded-full ${col} transition-all duration-500`}
        style={{ width: width + "%" }}
      />
    </div>
  );
}

export default ComparisonBar;
