import type {
  DemographicCategory,
  State,
  StateDemographics,
  CategoryWeights,
} from "@/lib/db/types";
import { ELECTION_2020_MARGIN, marginToLean } from "@/lib/data/2020ElectionResults";
import {
  getEconomicPositionName,
  getSocialPositionName,
  positionBucketColorClass,
} from "@/lib/utils/politics";

export interface CalculatedLean {
  economicLean: number;
  socialLean: number;
}

/**
 * Calculate state political lean from demographics.
 *
 * Turnout-weighted average of group positions. Each group's weight =
 * (population share) × (turnout rate) × (category weight).
 * Returns values on the same −5..+5 scale as the underlying group leans.
 */
export function calculateStateLean(
  demographics: StateDemographics,
  categories: DemographicCategory[]
): CalculatedLean {
  if (!demographics?.groups || !Array.isArray(categories) || categories.length === 0) {
    return { economicLean: 0, socialLean: 0 };
  }

  const groups = demographics.groups;
  let totalWeight = 0;
  let weightedEconomic = 0;
  let weightedSocial = 0;

  for (const category of categories) {
    const rawCatWeight = (demographics.categoryWeights ?? {})[category._id as string];
    // Only count categories this region explicitly weights. A category absent
    // from `categoryWeights` contributes 0 — NOT its `defaultWeight` — so a
    // region is never polluted by other countries' voter-group categories
    // (e.g. an IE region pulling in US/UK/JP voter groups). This matches
    // `computeMedianVoter`, the value the vote engine actually uses, so the
    // displayed region lean and the median voter always agree.
    const catWeight = rawCatWeight != null ? Number(rawCatWeight) : 0;
    if (!catWeight || catWeight <= 0) continue;

    for (const group of category.groups) {
      const stateGroup = groups[group.id];
      if (!stateGroup) continue;

      const pop = Number(stateGroup.population) || 0;
      const rawTurnout = (group as { defaultTurnout?: number }).defaultTurnout;
      const turnout =
        typeof stateGroup.turnout === "number"
          ? stateGroup.turnout
          : rawTurnout != null
            ? Number(rawTurnout)
            : 55;
      const weight = (pop / 100) * (turnout / 100) * (catWeight / 100);

      const economicLean =
        typeof stateGroup.economicLean === "number"
          ? stateGroup.economicLean
          : (group.defaultEconomicLean ?? 0);
      const socialLean =
        typeof stateGroup.socialLean === "number"
          ? stateGroup.socialLean
          : (group.defaultSocialLean ?? 0);

      totalWeight += weight;
      weightedEconomic += weight * economicLean;
      weightedSocial += weight * socialLean;
    }
  }

  if (totalWeight <= 0) {
    return { economicLean: 0, socialLean: 0 };
  }

  const economicLean = Math.max(
    -5,
    Math.min(5, Math.round((weightedEconomic / totalWeight) * 100) / 100)
  );
  const socialLean = Math.max(
    -5,
    Math.min(5, Math.round((weightedSocial / totalWeight) * 100) / 100)
  );

  return { economicLean, socialLean };
}

/**
 * Validate category weights sum to 100
 */
export function validateCategoryWeights(weights: CategoryWeights): boolean {
  const sum = Object.entries(weights).reduce(
    (s, [k, v]) => (k !== "_id" && typeof v === "number" ? s + v : s),
    0
  );
  return Math.abs(sum - 100) < 0.01;
}

/**
 * Compute single-axis display lean from dual economic/social axes.
 * When axes disagree in sign (e.g. econ -0.5, social +2), use the stronger axis
 * so red/blue states aren't compressed to center. When both same sign, use average.
 */
export function getDisplayLean(economicLean: number, socialLean: number): number {
  const sameSign = economicLean >= 0 === socialLean >= 0;
  if (sameSign) {
    return Math.round(((economicLean + socialLean) / 2) * 100) / 100;
  }
  const dominant = Math.abs(economicLean) >= Math.abs(socialLean) ? economicLean : socialLean;
  return Math.round(dominant * 100) / 100;
}

/**
 * Get lean label based on value.
 *
 * Labels use the shared −5..+5 position-name ruler (integer buckets). US state
 * leans come from the granular era-aware substrate (`calculateStateLeanForCache`
 * → `buildGranularElectorateSubstrate`), whose national spread is well under ±1,
 * so most states label as Centrist here; map fills use a continuous scale fitted
 * to the observed spread instead of these buckets. These values describe the
 * electorate's ideological center of gravity as derived from group compositions,
 * not a candidate's declared position.
 */
export function getLeanLabel(lean: number): string {
  return getEconomicPositionName(lean);
}

/** Social-axis equivalent of getLeanLabel, on the shared bucket ruler. */
export function getSocialLeanLabel(lean: number): string {
  return getSocialPositionName(lean);
}

/**
 * Get color class based on economic lean value.
 */
export function getLeanColor(lean: number): string {
  return positionBucketColorClass(lean, "economic");
}

/**
 * Format lean value for display
 */
export function formatLeanValue(lean: number): string {
  return lean >= 0 ? `+${lean.toFixed(2)}` : lean.toFixed(2);
}

/**
 * Get derived state lean - never baked in. Prefer cached demographics-derived leans,
 * fallback to 2020 election margin. Single source of truth for lean display and mechanics.
 */
export function getStateLean(state: State, stateId?: string): number {
  if (state.cachedEconomicLean != null && state.cachedSocialLean != null) {
    return getDisplayLean(state.cachedEconomicLean, state.cachedSocialLean);
  }
  const id = stateId ?? state._id;
  const margin = ELECTION_2020_MARGIN[id];
  if (margin !== undefined) {
    return marginToLean(margin);
  }
  return 0;
}
