import { getMetricShortName } from "@/lib/constants/metricDefinitions";

/** Human label for a `category.metricId` effect path. */
export function metricLabel(path: string): string {
  const id = path.split(".").pop() ?? path;
  const named = getMetricShortName(id);
  if (named) return named;
  // Fallback: humanize the camelCase segment.
  const spaced = id.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "+0.02/turn" style delta, sign preserved. */
export function fmtEffectDelta(delta: number): string {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}/turn`;
}
