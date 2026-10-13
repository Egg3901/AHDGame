import { SECTOR_SIGNAL_MAX, SECTOR_SIGNAL_MIN } from "@/lib/turn/gdpGrowth";

/**
 * Resolve authored crisis metrics to the channel owned by the metric engine.
 *
 * `bounds` is set when the resolved channel has no metric definition of its
 * own. `sectorGrowth` is an engine node, not a catalog metric, so without it
 * the crisis clamp fell back to the 0..100 default and floored every GDP shock
 * at zero growth: a region already below zero was lifted to zero by a negative
 * shock instead of pushed further down.
 */
export function resolveCrisisMetricPath(
  category: string,
  field: string
): {
  category: string;
  field: string;
  bounds?: readonly [number, number];
} {
  if (category === "economic" && field === "gdpGrowth") {
    return { category, field: "sectorGrowth", bounds: [SECTOR_SIGNAL_MIN, SECTOR_SIGNAL_MAX] };
  }
  return { category, field };
}
