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
 * Build re-centered cohorts from a region's demographic groups: layer each
 * group's affinity onto the region desire, then additively shift all leans so
 * the turnout-weighted aggregate equals `regionDesire` exactly.
 */
export function buildReferendumCohorts(
  groups: Record<
    string,
    { population: number; economicLean: number; socialLean: number; turnout?: number }
  >,
  regionDesire: number,
  affinities: Record<string, number>
): ReferendumCohort[] {
  const entries = Object.entries(groups);
  const totalPop = entries.reduce((s, [, g]) => s + (g.population || 0), 0) || 1;
  const raw: ReferendumCohort[] = entries.map(([groupId, g]) => ({
    groupId,
    share: (g.population || 0) / totalPop,
    turnout: clamp(g.turnout ?? 60, 0, 100),
    yesLean: clamp(regionDesire + (affinities[groupId] ?? 0), 0, 100),
  }));
  // Re-center: additive shift so the weighted aggregate == regionDesire.
  const agg = aggregateYesShare(raw, [], 0);
  const shift = regionDesire - agg;
  return raw.map((c) => ({ ...c, yesLean: clamp(c.yesLean + shift, 0, 100) }));
}
