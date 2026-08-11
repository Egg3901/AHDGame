/**
 * SP4 hybrid political approval model (political-consumers spec §2).
 *
 * Pure math over a national/regional political-metrics board:
 *   component = 0.7 × scaled(objective) + 0.3 × scaled(affinity)
 * where the affinity term weights each family by the electorate's ideological
 * distance to the family's lean. This is the one place metric leans are
 * consumed as mechanics — lean is ASSOCIATION, never quality, so it shapes who
 * CARES about a metric, not whether the metric is good.
 *
 * No db imports — async loading lives in politicalApprovalProvider.ts.
 */

import { overallScore } from "@/lib/politicalMetrics/aggregate";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import type { PoliticalLean, PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { NON_PLAYABLE_APPROVAL_NEUTRALS } from "@/lib/politicalMetrics/seeds/approvalNeutrals";

export const APPROVAL_OBJECTIVE_WEIGHT = 0.7;
export const APPROVAL_AFFINITY_WEIGHT = 0.3;

/**
 * Board score at which the approval component is zero, per country —
 * CALIBRATED to each country's day-one 1953 seed board (spec §2 intercept:
 * cutover must not lurch approval). Values are the 0.7·objective +
 * 0.3·affinity(0) blend of NATIONAL_BASELINES_1953 (regional modifiers are
 * sparse and roughly balanced, so the baseline board is the national mean to
 * within noise; measured 2026-07-20: US obj 64.78/aff 65.24, UK 63.00/63.21,
 * RU 58.73/59.31). A per-country intercept reproduces the legacy RELATIVE
 * model's day-one neutrality — RU's harder board reads worse objectively but
 * starts approval-neutral, exactly as scoring-vs-own-average did.
 */
export const APPROVAL_NEUTRAL_SCORE: Record<string, number> = {
  // The four playables are AUTHORED calibration from their national baseline
  // board, and are era-agnostic: their anchors currently hold one 1953 value
  // per family, so there is nothing era-varying to calibrate against yet.
  US: 64.92,
  UK: 63.06,
  RU: 58.91,
  DD: 55.0, // section 2 calibration: 70/30 blend of the authored DD 1953 board
};

/**
 * The intercept for a country, or a thrown error.
 *
 * Playables resolve from the authored table above. Non-playables resolve from
 * the DERIVED per-preset table, because their board is per-preset: each era
 * overlays its own authored metric values and is scored against that era's
 * band, so an era sits at its own level and reusing one intercept across eras
 * would lurch approval in every era but the one it was measured in.
 *
 * Never defaults. A missing intercept means the country was routed to the
 * political pipeline without a calibrated neutral, and any fallback (50, or the
 * board mean) would silently shift every one of its regions' approval — the
 * exact lurch the per-country intercept exists to prevent. Failing loudly at
 * the seam is the cheaper outcome.
 */
export function approvalNeutralFor(countryId: string, presetId?: string | null): number {
  const authored = APPROVAL_NEUTRAL_SCORE[countryId];
  if (Number.isFinite(authored)) return authored;
  const derived = presetId ? NON_PLAYABLE_APPROVAL_NEUTRALS[presetId]?.[countryId] : undefined;
  if (Number.isFinite(derived)) return derived as number;
  throw new Error(
    `No APPROVAL_NEUTRAL_SCORE calibrated for country ${countryId} at preset ${presetId ?? "(none)"}`
  );
}

export const APPROVAL_POINTS_PER_SCORE = 0.5;

/**
 * A region's electorate lean: straight average of the cached SSOT lean pair
 * (maintained by demographicEffects; see getStateLean). Deliberate departures
 * from getStateLean (spec §2): both axes average (affinity measures overall
 * ideological distance, not the dominant-axis partisan label), and missing
 * caches mean 0 / flat model (never the 2020-election-margin display
 * fallback). Clamped to the −5..+5 lean scale.
 */
export function electorateLean(state: {
  cachedEconomicLean?: number | null;
  cachedSocialLean?: number | null;
}): number {
  const econ = state.cachedEconomicLean;
  const social = state.cachedSocialLean;
  if (typeof econ !== "number" || typeof social !== "number") return 0;
  if (!Number.isFinite(econ) || !Number.isFinite(social)) return 0;
  return Math.max(-5, Math.min(5, (econ + social) / 2));
}

/** 1 at zero ideological distance, 0 at the maximum (10); lean-0 metrics floor at 0.5. */
export function metricAffinity(electorate: number, lean: PoliticalLean): number {
  return Math.max(0, Math.min(1, 1 - Math.abs(electorate - lean) / 10));
}

/** Mean of the nine category means (0–100) — the flat, ideology-blind read. */
export function objectiveScore(values: Record<PoliticalMetricId, number>): number {
  return overallScore(values);
}

/** Affinity-weighted mean over all 63 families (0–100). */
export function affinityScore(
  values: Record<PoliticalMetricId, number>,
  electorate: number
): number {
  let weighted = 0;
  let weightSum = 0;
  for (const family of POLITICAL_METRIC_FAMILIES) {
    const affinity = metricAffinity(electorate, family.lean);
    weighted += affinity * (values[family.id] ?? 0);
    weightSum += affinity;
  }
  // weightSum > 0 always: lean-0 families carry affinity >= 0.5 for any
  // electorate in the -5..+5 range (the "starving is unpopular" floor).
  return weightSum > 0 ? weighted / weightSum : 0;
}

/**
 * The metric-driven approval component (points around the surface's base
 * approval; negative = disapproval pressure). Hybrid 70/30 per spec §2.
 */
export function approvalComponent(
  values: Record<PoliticalMetricId, number>,
  electorate: number,
  countryId: string,
  presetId?: string | null
): number {
  const neutral = approvalNeutralFor(countryId, presetId);
  const scaled = (score: number) => (score - neutral) * APPROVAL_POINTS_PER_SCORE;
  return (
    APPROVAL_OBJECTIVE_WEIGHT * scaled(objectiveScore(values)) +
    APPROVAL_AFFINITY_WEIGHT * scaled(affinityScore(values, electorate))
  );
}
