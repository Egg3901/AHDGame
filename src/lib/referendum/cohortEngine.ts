/**
 * Pure cohort engine for referendums. A region's electorate is split into
 * demographic cohorts; each has a Yes-lean re-centered to the region's desire
 * at campaign open. The canonical yesShare is the turnout-weighted aggregate
 * of current leans (after channel modifiers). No DB I/O.
 */
import {
  cumulativeCampaignEffect,
  GG_LEAN_MOD_CAP,
  GG_TURNOUT_MOD_CAP,
} from "@/lib/constants/referendum";

export interface ReferendumCohort {
  groupId: string;
  share: number; // 0..1 of the electorate
  turnout: number; // 0..100 baseline turnout
  yesLean: number; // 0..100 baseline Yes share within the cohort
}

export interface CohortModifier {
  groupId: string;
  turnoutMod: number;
  leanMod: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Raw accumulated units → effective modifier (soft cap via tanh: ≈ identity
 *  near 0 so small spend matches its authored swing, asymptotes to ±cap). */
export function saturate(raw: number, cap: number): number {
  return cap * Math.tanh(raw / cap);
}
export const effLean = (raw: number) => saturate(raw, GG_LEAN_MOD_CAP);
export const effTurnout = (raw: number) => saturate(raw, GG_TURNOUT_MOD_CAP);

/** PS spend → a uniform lean shift, reusing the diminishing-returns curve. */
export function leanFromUnits(yesUnits: number, noUnits: number): number {
  return cumulativeCampaignEffect(yesUnits) - cumulativeCampaignEffect(noUnits);
}

/**
 * Turnout-weighted aggregate of `cohorts` after `modifiers` + a uniform shift.
 * `modifiers` carry RAW accumulated ground-game units; the per-cohort soft cap
 * (`saturate`) is applied here at read time, so repeated spend tapers smoothly
 * and contested spend (raw summing to 0) cancels exactly.
 */
export function aggregateYesShare(
  cohorts: ReferendumCohort[],
  modifiers: CohortModifier[],
  uniformLeanShift: number
): number {
  const modById = new Map(modifiers.map((m) => [m.groupId, m]));
  let num = 0;
  let den = 0;
  for (const c of cohorts) {
    const m = modById.get(c.groupId);
    const turnout = clamp(c.turnout + effTurnout(m?.turnoutMod ?? 0), 0, 100);
    const lean = clamp(c.yesLean + effLean(m?.leanMod ?? 0) + uniformLeanShift, 0, 100);
    const weight = c.share * turnout;
    num += weight * lean;
    den += weight;
  }
  if (den === 0) return clamp(uniformLeanShift, 0, 100);
  return clamp(num / den, 0, 100);
}

/**
 * Build re-centered cohorts from a region's Layer-1 bucket profile: layer each
 * bucket's affinity onto the region desire, then additively shift all leans so
 * the turnout-weighted aggregate equals `regionDesire` exactly.
 *
 * Cohorts are census buckets rather than voter archetypes, which is what makes
 * a cohort something a player can also poll, canvass and target a Governor's
 * Address at — one vocabulary across the interface instead of a referendum-only
 * one.
 *
 * SHARE NORMALISATION. A bucket profile gives shares that sum to 100 WITHIN a
 * dimension, so the five UK dimensions describe the same electorate five times
 * over. Each bucket's share is therefore divided by the number of dimensions,
 * which makes the shares sum to 1 across the whole table and gives every
 * dimension equal say. The cost is that cross-dimension correlation is lost —
 * a young urban graduate is counted once in each of three dimensions at a third
 * of the weight rather than once as one person. That is the standard
 * marginals-only approximation, and it is acceptable here because the
 * re-centering below makes the aggregate exact regardless, and the ground game
 * operates on marginals anyway.
 *
 * Single-bucket dimensions are dropped. Northern Ireland's ethnicity marginal
 * is 100% white British, so keeping it would spend a fifth of the electorate's
 * weight on a cohort that cannot differentiate between Yes and No and would
 * flatten the other four dimensions by that much for no information.
 */
export function buildReferendumCohorts(
  sections: Array<{
    dim: string;
    buckets: Array<{ id: string; sharePct: number; turnout: number }>;
  }>,
  regionDesire: number,
  affinities: Record<string, number>
): ReferendumCohort[] {
  const informative = sections.filter((s) => s.buckets.length > 1);
  const used = informative.length > 0 ? informative : sections.filter((s) => s.buckets.length > 0);
  const dimCount = used.length;
  if (dimCount === 0) return [];
  const raw: ReferendumCohort[] = used.flatMap((section) =>
    section.buckets.map((bucket) => ({
      groupId: bucket.id,
      share: bucket.sharePct / 100 / dimCount,
      turnout: clamp(bucket.turnout, 0, 100),
      yesLean: clamp(regionDesire + (affinities[bucket.id] ?? 0), 0, 100),
    }))
  );
  // Re-center: additive shift so the weighted aggregate == regionDesire.
  const agg = aggregateYesShare(raw, [], 0);
  const shift = regionDesire - agg;
  return raw.map((c) => ({ ...c, yesLean: clamp(c.yesLean + shift, 0, 100) }));
}
