import type { MapMetricDefinition } from "@/lib/map/metricTypes";

export function formatMapMetric(
  value: number | undefined,
  definition: MapMetricDefinition,
  compact = false
): string {
  if (value == null || !Number.isFinite(value)) return "";
  const number = new Intl.NumberFormat("en-US", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : definition.decimals,
  }).format(value);
  return `${definition.prefix}${number}${definition.suffix}`;
}
export function metricExtent(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
  };
}
export function metricRatio(value: number, min: number, max: number) {
  return max === min ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min)));
}
/** Sequential data colors encode magnitude, never whether a policy score is desirable. */
export function metricColor(value: number, min: number, max: number) {
  const t = metricRatio(value, min, max);
  // A dedicated data palette keeps geographic fills readable in every app theme.
  return `rgb(${Math.round(208 - 182 * t)}, ${Math.round(230 - 152 * t)}, ${Math.round(245 - 87 * t)})`;
}
export function metricDistribution(values: number[], min: number, max: number) {
  const bins = Array.from({ length: 5 }, () => 0);
  for (const value of values)
    if (Number.isFinite(value)) bins[Math.min(4, Math.floor(metricRatio(value, min, max) * 5))]++;
  return bins;
}
