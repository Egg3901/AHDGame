/**
 * Apportion an aggregate region's voter-archetype split across its seceding
 * sub-regions, preserving the live aggregate.
 *
 * The per-era `DemographicPattern` (see seeds/{sco,wal}RegionDemographics) gives
 * each sub-region's population shares over the shared 12 voter groups. We do NOT
 * use those shares as absolute values — instead each sub-region's share for a
 * group is the LIVE aggregate's share plus that region's *tilt*: its deviation
 * from the pattern's population-weighted average for that group.
 *
 *   share(region, group) = liveAgg(group) + (pattern(region, group) − patternBar(group))
 *   patternBar(group)    = Σ_region popWeight(region) · pattern(region, group)
 *
 * Because the tilts are population-weighted-zero, this guarantees:
 *   • each sub-region's shares still sum to the aggregate total (≈100), and
 *   • the population-weighted average across sub-regions equals the live
 *     aggregate exactly — so mid-game demographic drift carries through.
 *
 * Per-group lean/turnout are inherited from the live aggregate (uniform across
 * sub-regions); the regional differentiation lives entirely in the population
 * mix. Negative shares (rare, only with large tilts on a small aggregate share)
 * are clamped at 0 and the row is renormalised back to the aggregate total.
 */

export interface DemoGroup {
  population: number;
  economicLean: number;
  socialLean: number;
  turnout: number;
  /** Preserved through apportionment; only `population` is re-derived. */
  nameRecognition?: number;
}

export type DemographicGroups = Record<string, DemoGroup>;
export type DemographicPattern = Record<string, Record<string, number>>;

/** Largest-remainder rounding of `values` (keyed) to integers summing to `target`. */
function roundToTotal(values: Record<string, number>, target: number): Record<string, number> {
  const keys = Object.keys(values);
  const floors: Record<string, number> = {};
  let used = 0;
  const remainders: Array<{ k: string; r: number }> = [];
  for (const k of keys) {
    const f = Math.floor(values[k]);
    floors[k] = f;
    used += f;
    remainders.push({ k, r: values[k] - f });
  }
  let deficit = Math.round(target) - used;
  remainders.sort((a, b) => b.r - a.r);
  for (let i = 0; i < remainders.length && deficit > 0; i++, deficit--) {
    floors[remainders[i].k] += 1;
  }
  return floors;
}

export function apportionDemographicShares(
  aggGroups: DemographicGroups,
  pattern: DemographicPattern,
  popWeights: Record<string, number>
): Record<string, DemographicGroups> {
  const groupIds = Object.keys(aggGroups);
  const regionIds = Object.keys(pattern);
  const aggTotal = groupIds.reduce((s, g) => s + (aggGroups[g]?.population ?? 0), 0);

  // Population-weighted average of the pattern shares per group.
  const totalWeight = regionIds.reduce((s, r) => s + (popWeights[r] ?? 0), 0) || 1;
  const patternBar: Record<string, number> = {};
  for (const g of groupIds) {
    let acc = 0;
    for (const r of regionIds) acc += (popWeights[r] ?? 0) * (pattern[r]?.[g] ?? 0);
    patternBar[g] = acc / totalWeight;
  }

  const out: Record<string, DemographicGroups> = {};
  for (const r of regionIds) {
    const raw: Record<string, number> = {};
    let sum = 0;
    for (const g of groupIds) {
      const tilt = (pattern[r]?.[g] ?? patternBar[g]) - patternBar[g];
      const v = Math.max(0, (aggGroups[g]?.population ?? 0) + tilt);
      raw[g] = v;
      sum += v;
    }
    // Renormalise to the aggregate total (corrects any clamping drift), then
    // round to integer shares that sum to it exactly.
    const k = sum > 0 ? aggTotal / sum : 0;
    const scaled: Record<string, number> = {};
    for (const g of groupIds) scaled[g] = raw[g] * k;
    const rounded = roundToTotal(scaled, aggTotal);

    out[r] = {};
    for (const g of groupIds) {
      // Inherit every per-group field (lean/turnout/nameRecognition) from the
      // live aggregate; only the population share is re-derived per region.
      out[r][g] = { ...aggGroups[g], population: rounded[g] };
    }
  }
  return out;
}
