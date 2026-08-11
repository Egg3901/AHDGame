"use client";

interface TrendChipProps {
  /** Percent change; null/undefined or |trend|<0.05 renders "flat". */
  trend?: number | null;
  /** Whether a higher value is better (decides good/bad coloring). */
  isHigherBetter: boolean;
}

/** Percent-change chip, colored good/bad by metric direction. */
export function TrendChip({ trend, isHigherBetter }: TrendChipProps) {
  if (trend == null || Math.abs(trend) < 0.05) {
    return <span className="text-[11px] text-muted">flat</span>;
  }
  const good = isHigherBetter ? trend > 0 : trend < 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-semibold tabular-nums ${
        good ? "text-success" : "text-error"
      }`}
    >
      {trend > 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
    </span>
  );
}

export default TrendChip;
