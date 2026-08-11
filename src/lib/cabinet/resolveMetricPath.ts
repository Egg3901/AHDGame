import { metricCategories } from "@/lib/constants/metricDefinitions";

/**
 * Resolve a bare metric id (e.g. "gdpGrowth") to its full nested
 * StateMetrics path (e.g. "economic.gdpGrowth"). Already-dotted keys are
 * returned unchanged, so this is safe to apply idempotently.
 *
 * Resolution order: an optional list of the position's own metric configs
 * (so a position can disambiguate), then the global metric registry.
 */
export function resolveMetricPath(
  metricKey: string,
  positionMetrics: Array<{ category: string; metricId: string }> = []
): string {
  if (metricKey.includes(".")) return metricKey;

  const match = positionMetrics.find((metric) => metric.metricId === metricKey);
  if (match) return `${match.category}.${match.metricId}`;

  for (const category of metricCategories) {
    const categoryMatch = category.metrics.find((metric) => metric.id === metricKey);
    if (categoryMatch) return `${category.id}.${categoryMatch.id}`;
  }

  return metricKey;
}
