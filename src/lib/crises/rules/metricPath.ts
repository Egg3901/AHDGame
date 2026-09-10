/** Resolve authored crisis metrics to the channel owned by the metric engine. */
export function resolveCrisisMetricPath(
  category: string,
  field: string
): {
  category: string;
  field: string;
} {
  if (category === "economic" && field === "gdpGrowth") {
    return { category, field: "sectorGrowth" };
  }
  return { category, field };
}
