"use client";

interface TickChipProps {
  /** Active per-turn policy effect; falsy / |tick|<0.0001 renders nothing. */
  tick?: number;
  /** Whether a higher value is better (decides good/bad coloring). */
  isHigherBetter: boolean;
  /** Metric unit suffix (e.g. "%"). */
  suffix?: string;
}

/**
 * Policy tick-rate chip ("↑ 0.25%/turn") with a native tooltip explaining the
 * 48-turn (one game year) drift, matching the existing MetricCard phrasing.
 */
export function TickChip({ tick, isHigherBetter, suffix = "" }: TickChipProps) {
  if (!tick || Math.abs(tick) < 0.0001) return null;
  const good = isHigherBetter ? tick > 0 : tick < 0;
  const abs = Math.abs(tick);
  const dec = abs < 0.1 ? 3 : abs < 1 ? 2 : 1;
  const tooltip = `Active policy effect: ${tick > 0 ? "+" : "−"}${abs.toFixed(dec)}${suffix} per turn. Over 48 turns (1 game year) this will ${
    tick > 0 ? "increase" : "decrease"
  } by ~${(abs * 48).toFixed(1)}${suffix}.`;
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded border px-1 text-[10px] font-semibold tabular-nums ${
        good ? "border-success/40 text-success" : "border-error/40 text-error"
      }`}
    >
      {tick > 0 ? "↑" : "↓"} {abs.toFixed(dec)}
      {suffix}/turn
    </span>
  );
}

export default TickChip;
