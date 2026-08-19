import type { CountryLayer1Model } from "./types";
import type { StateDemographics, StateDemographicGroup } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

function clampLean(v: number): number {
  return Math.max(-5, Math.min(5, Math.round(v * 10) / 10));
}

/**
 * Build seedable per-region StateDemographics from a country Layer-1 model:
 * each region's archetype population/econ/social/turnout are derived from the
 * region's real census via the model's composition + per-era positions. This is
 * the gated alternative to the static {c}RegionDemographics seed arrays.
 */
export function buildModelRegionDemographics(
  model: CountryLayer1Model,
  positionsOverride?: CountryLayer1Model["positions"],
  override?: {
    turnout?: Record<string, Record<string, number>>;
  }
): StateDemographics[] {
  // Deep-merge override over model.positions (override wins per dim/key)
  const mergedPositions: CountryLayer1Model["positions"] = positionsOverride
    ? {
        ...model.positions,
        ...Object.fromEntries(
          Object.entries(positionsOverride).map(([dim, keys]) => [
            dim,
            { ...(model.positions[dim] ?? {}), ...keys },
          ])
        ),
      }
    : model.positions;

  // Merge turnout per dim/key, override wins.
  const merged: CountryLayer1Model = override
    ? {
        ...model,
        turnoutRates: override.turnout
          ? {
              ...model.turnoutRates,
              ...Object.fromEntries(
                Object.entries(override.turnout).map(([dim, keys]) => [
                  dim,
                  { ...(model.turnoutRates[dim] ?? {}), ...keys },
                ])
              ),
            }
          : model.turnoutRates,
      }
    : model;

  const out: StateDemographics[] = [];
  for (const [regionId, config] of Object.entries(merged.census)) {
    const pops = deriveCountryGroupPopulations(merged, config);
    const groups: Record<string, StateDemographicGroup> = {};
    for (const gid of merged.groupIds) {
      const lean = deriveCountryGroupLean(merged, gid, config, mergedPositions);
      groups[gid] = {
        population: Math.round((pops[gid] ?? 0) * 100) / 100,
        economicLean: lean.economicLean,
        socialLean: lean.socialLean,
        turnout: deriveCountryGroupTurnout(merged, gid),
      };
    }
    out.push({
      _id: regionId,
      countryId: model.countryId as CountryId,
      categoryWeights: { [model.categoryId]: 100 },
      groups,
      lastUpdated: new Date(),
    });
  }
  return out;
}

export function deriveCountryGroupLean(
  model: CountryLayer1Model,
  groupId: string,
  config: Record<string, Record<string, number>>,
  positionsOverride?: CountryLayer1Model["positions"]
): { economicLean: number; socialLean: number } {
  const positions = positionsOverride ?? model.positions;
  const comp = model.composition[groupId];
  const fallback = model.defaultLeans[groupId] ?? { economicLean: 0, socialLean: 0 };
  if (!comp) return fallback;
  let wSum = 0,
    e = 0,
    s = 0;
  for (const { dim, key, w } of comp.weights) {
    const share = config[dim]?.[key] ?? 0;
    const pos = positions[dim]?.[key];
    if (!pos) {
      if (process.env.NODE_ENV === "development") {
        console.warn(`[Layer1:${model.countryId}] No position for ${dim}.${key} — weight dropped`);
      }
      continue;
    }
    const weight = w * (share / 100);
    wSum += weight;
    e += weight * pos.economicLean;
    s += weight * pos.socialLean;
  }
  if (wSum <= 0) return fallback;
  return { economicLean: clampLean(e / wSum), socialLean: clampLean(s / wSum) };
}

export function deriveCountryGroupPopulations(
  model: CountryLayer1Model,
  config: Record<string, Record<string, number>>
): Record<string, number> {
  const vw: Record<string, Record<string, number>> = {};
  for (const dim of model.dims) {
    vw[dim] = {};
    for (const [key, pct] of Object.entries(config[dim] ?? {}))
      vw[dim][key] = (pct * (model.turnoutRates[dim]?.[key] ?? 55)) / 100;
  }
  const raw: Record<string, number> = {};
  for (const gid of model.groupIds) {
    const comp = model.composition[gid];
    let score = 0;
    for (const { dim, key, w } of comp?.weights ?? []) score += (vw[dim]?.[key] ?? 0) * w;
    score *= comp?.civicMultiplier ?? 1;
    raw[gid] = score;
  }
  const total = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  for (const gid of model.groupIds) raw[gid] = (raw[gid] / total) * 100;
  return raw;
}

export function deriveCountryGroupTurnout(model: CountryLayer1Model, groupId: string): number {
  const comp = model.composition[groupId];
  if (!comp) return 60;
  const tw = comp.weights.reduce((a, c) => a + c.w, 0) || 1;
  let base = 0;
  for (const { dim, key, w } of comp.weights)
    base += (model.turnoutRates[dim]?.[key] ?? 55) * (w / tw);
  base *= comp.civicMultiplier ?? 1;
  return Math.round(Math.max(25, Math.min(85, base)));
}
