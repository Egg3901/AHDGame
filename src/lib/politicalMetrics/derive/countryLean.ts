/**
 * The country political-lean signal, and the tier-3 spread it drives.
 *
 * WHY THIS EXISTS — tier 3 resolves a family to the average of its mapped
 * legacy CATEGORY, so every tier-3 family in a category came out identical:
 * `order.dueProcess` (lean -5) and `order.deterrence` (lean +5) scored the same
 * for every country despite being ideological opposites. Across a real seed
 * that was 17 families collapsing to 7 distinct values.
 *
 * The legacy metric block genuinely cannot separate them — it measures
 * outcomes, not positions. But the party seeds CAN: each carries an authored
 * `economicPosition`/`socialPosition` on the same -5..+5 scale the families use,
 * and they are preset-gated, so a 1953 roster describes the 1953 regime.
 * Hungary's 1953 MDP is (-4, +2) — command economy, ÁVH terror state — which is
 * exactly the character the outcome metrics fail to encode.
 *
 * So the category average sets the LEVEL and the country lean sets the TILT:
 * a family is displaced from its category average in proportion to how well its
 * own lean aligns with the country's lean on that category's axis. A centrist
 * party system produces zero displacement and the previous behaviour exactly.
 *
 * This is NOT the "spreading values around the category mean" that
 * deriveFamilies warns against. That warning is about inventing a spread with
 * no signal behind it; this spread is driven by authored, era-gated, reviewable
 * position data, and it vanishes when that data says the country has no tilt.
 *
 * DELIBERATELY NOT MEAN-PRESERVING. Displacement is measured from lean 0, not
 * from the mean lean of the tier-3 families present, so a category whose
 * surviving tier-3 families are all right-leaning (governance: +1/+3/+5) does
 * shift as a group. That is the point — it is the new information. Measuring
 * from the tier-3 mean would cancel most of the signal for exactly the
 * categories that need it most.
 *
 * OFFLINE USE ONLY — feeds the codegen whose output is committed and reviewed.
 */
import { getFamily } from "../families";
import type { PoliticalMetricCategoryId, PoliticalMetricId } from "../types";

/** A country's political centre of gravity, on the family -5..+5 lean scale. */
export interface CountryLean {
  economic: number;
  social: number;
}

/** The party-seed fields this needs — structural, so tests need no seed import. */
export interface LeanPartySeed {
  economicPosition: number;
  socialPosition: number;
  treasury?: number | null;
  validForPresets?: string[];
}

/**
 * Board points of displacement at maximum alignment (a lean-±5 family in a
 * country whose lean on that axis is ±5).
 *
 * Sized so the tilt is legible without overriding the legacy level: 15 points
 * separates `dueProcess` from `deterrence` by up to 30 in a hard regime, while
 * the category average still decides which half of the board they sit in. Every
 * real 1953 country lands well inside this — the Western democracies compute to
 * |lean| < 1, so they move by under 3 points.
 */
export const TIER3_LEAN_SPREAD = 15;

/** The -5..+5 scale shared by family leans and authored party positions. */
const LEAN_SCALE = 5;

/**
 * Which axis of the country lean each political category reads.
 *
 * Categories about who PROVIDES and who PAYS read the economic axis; categories
 * about liberty, authority and social order read the social axis. `defense` is
 * hand-authored at tier 4 and never reaches this table, but it is mapped so the
 * record stays total over the category union.
 */
export const CATEGORY_LEAN_AXIS: Record<PoliticalMetricCategoryId, keyof CountryLean> = {
  economy: "economic",
  education: "economic",
  health: "economic",
  infrastructure: "economic",
  environment: "economic",
  order: "social",
  society: "social",
  governance: "social",
  defense: "social",
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Treasury-weighted mean of the positions of every party valid at `preset`, or
 * null when the country has no roster for that era.
 *
 * Weighting matters: seeded treasury is the only prominence signal the roster
 * carries, and equal weighting lets token parties outvote a dominant one — it
 * reads Maoist China (CCP at 2M against two CPPCC bloc parties at 200k each) as
 * barely left of centre. Where every treasury is zero the weights collapse to
 * equal rather than dividing by zero.
 */
export function countryLeanFromParties(
  parties: readonly LeanPartySeed[],
  preset: string
): CountryLean | null {
  const valid = parties.filter(
    (p) =>
      (!p.validForPresets || p.validForPresets.includes(preset)) &&
      Number.isFinite(p.economicPosition) &&
      Number.isFinite(p.socialPosition)
  );
  if (valid.length === 0) return null;

  // Negative treasury is meaningless as a weight and would flip a party's
  // contribution, so it floors at zero along with the all-zero fallback.
  const weightOf = (p: LeanPartySeed) => Math.max(0, p.treasury ?? 0);
  const totalWeight = valid.reduce((sum, p) => sum + weightOf(p), 0);
  const weight = totalWeight > 0 ? weightOf : () => 1;
  const denominator = valid.reduce((sum, p) => sum + weight(p), 0);
  if (denominator <= 0) return null;

  const axis = (pick: (p: LeanPartySeed) => number) =>
    valid.reduce((sum, p) => sum + weight(p) * pick(p), 0) / denominator;

  return {
    economic: axis((p) => p.economicPosition),
    social: axis((p) => p.socialPosition),
  };
}

/**
 * Displace a tier-3 category average by how well the family's lean aligns with
 * the country's lean on that category's axis.
 *
 * Returns `base` unchanged when either lean is zero, so a centrist country or a
 * lean-0 family reproduces the previous derivation exactly.
 *
 * Throws on an unknown family id rather than falling back to `base`: this feeds
 * committed seed data, where a silently untilted value is indistinguishable
 * from a correctly untilted one.
 */
export function leanAdjustedTier3(
  base: number,
  familyId: string,
  lean: CountryLean | null | undefined
): number {
  if (!lean) return base;
  const categoryId = familyId.split(".")[0] as PoliticalMetricCategoryId;
  const axis = CATEGORY_LEAN_AXIS[categoryId];
  if (!axis) return base;

  const countryLean = lean[axis];
  if (!Number.isFinite(countryLean) || countryLean === 0) return base;

  const familyLean = getFamily(familyId as PoliticalMetricId).lean;
  if (familyLean === 0) return base;

  const alignment =
    (familyLean / LEAN_SCALE) * (clamp(countryLean, -LEAN_SCALE, LEAN_SCALE) / LEAN_SCALE);
  return clamp(base + alignment * TIER3_LEAN_SPREAD, 0, 100);
}
