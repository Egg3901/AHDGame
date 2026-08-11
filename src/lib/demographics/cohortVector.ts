/**
 * Cohort vector: the canonical single-year age×sex population stock and the pure
 * derived-view helpers that read it (design §4.1, §4.3).
 *
 * The vector (`AgeSexVector`) is the SSOT. Every grouping below is a DERIVED view
 * computed on read — none of it is ever stored. Index 0..100, where index 100
 * absorbs the "100+" tail. All helpers are pure (no DB), so they are cheap to
 * test and to benchmark in the blocking perf gate (R4/B2).
 */

import { DEFAULT_VOTING_AGE } from "@/lib/constants/votingAge";
import { DEFAULT_WORKING_AGE, DEFAULT_RETIREMENT_AGE } from "@/lib/constants/laborAge";

export interface AgeSexVector {
  male: number[]; // length 101: ages 0..100 (100 = "100+")
  female: number[]; // length 101
}

/** Age band boundaries (inclusive lower bounds), shared by every derived view. */
export const AGE_BANDS = {
  youthMax: 17, // 0..17
  youngMin: 18, // 18..29
  midMin: 30, // 30..44
  matureMin: 45, // 45..64
  seniorMin: 65, // 65..100
  workingMin: 18, // working-age 18..64
  workingMax: 64,
  childbearingMin: 18, // female childbearing pool 18..44
  childbearingMax: 44,
} as const;

const LAST_INDEX = 100;

function sumBoth(v: AgeSexVector, lo: number, hi: number): number {
  let total = 0;
  const top = Math.min(hi, LAST_INDEX);
  for (let age = Math.max(lo, 0); age <= top; age++) {
    total += (v.male[age] ?? 0) + (v.female[age] ?? 0);
  }
  return total;
}

/** Total population: Σ over both sexes, all ages. */
export function totalPopulation(v: AgeSexVector): number {
  return sumBoth(v, 0, LAST_INDEX);
}

/** Coarse age groups (Σ over sex), partitioning the whole vector. */
export function coarseGroups(v: AgeSexVector): {
  youth: number; // 0..17
  young: number; // 18..29
  mid: number; // 30..44
  mature: number; // 45..64
  senior: number; // 65..100
} {
  return {
    youth: sumBoth(v, 0, AGE_BANDS.youthMax),
    young: sumBoth(v, AGE_BANDS.youngMin, AGE_BANDS.midMin - 1),
    mid: sumBoth(v, AGE_BANDS.midMin, AGE_BANDS.matureMin - 1),
    mature: sumBoth(v, AGE_BANDS.matureMin, AGE_BANDS.seniorMin - 1),
    senior: sumBoth(v, AGE_BANDS.seniorMin, LAST_INDEX),
  };
}

/** Working-age population: Σ ages 18..64, both sexes. */
export function workingAge(v: AgeSexVector): number {
  return sumBoth(v, AGE_BANDS.workingMin, AGE_BANDS.workingMax);
}

/**
 * Voting-eligible population: Σ both sexes at or above `votingAge` (default 18).
 * The election turnout pool consumes this so the electorate tracks kids aging
 * past the threshold and deaths removing voters (P1b-1b). `votingAge` is the
 * configurable `votingAgeEligible` threshold (future-law-changeable).
 */
export function votingAgePopulation(
  v: AgeSexVector,
  votingAge: number = DEFAULT_VOTING_AGE
): number {
  let total = 0;
  const lo = Math.max(0, Math.min(LAST_INDEX, Math.floor(votingAge)));
  for (let age = lo; age <= LAST_INDEX; age++) {
    total += (v.male[age] ?? 0) + (v.female[age] ?? 0);
  }
  return total;
}

/**
 * Working-age (labor-force) population: Σ both sexes in the half-open band
 * [lower, upper) — default 18..64 (so 64 = retirement excludes age 64+). Written
 * per-region by the demographic phase and handed to the P1c GDP engine as the
 * labor force `L` (design §5.1). `lower` / `upper` are the configurable
 * workingAgeEligible / retirementAgeEligible thresholds.
 */
export function workingAgePopulation(
  v: AgeSexVector,
  lower: number = DEFAULT_WORKING_AGE,
  upper: number = DEFAULT_RETIREMENT_AGE
): number {
  const lo = Math.max(0, Math.min(LAST_INDEX, Math.floor(lower)));
  const hi = Math.max(lo, Math.min(LAST_INDEX, Math.floor(upper)));
  let total = 0;
  for (let age = lo; age < hi; age++) total += (v.male[age] ?? 0) + (v.female[age] ?? 0);
  return total;
}

/** Childbearing pool: FEMALE ages 18..44 only (no ½ proxy). */
export function childbearing(v: AgeSexVector): number {
  let total = 0;
  for (let age = AGE_BANDS.childbearingMin; age <= AGE_BANDS.childbearingMax; age++) {
    total += v.female[age] ?? 0;
  }
  return total;
}

/**
 * Median age: the age at which cumulative population crosses 50%. Linear
 * within-year interpolation so a perfectly symmetric vector returns its center.
 * Returns 0 for an empty vector.
 */
export function medianAgeFromVector(v: AgeSexVector): number {
  const total = totalPopulation(v);
  if (total <= 0) return 0;
  const half = total / 2;
  let cumulative = 0;
  for (let age = 0; age <= LAST_INDEX; age++) {
    const inYear = (v.male[age] ?? 0) + (v.female[age] ?? 0);
    if (cumulative + inYear >= half) {
      // Grouped-median interpolation with each year centered on `age` (band
      // [age-0.5, age+0.5)): a symmetric vector returns its exact center.
      const into = inYear > 0 ? (half - cumulative) / inYear : 0;
      return Math.max(0, age - 0.5 + into);
    }
    cumulative += inYear;
  }
  return LAST_INDEX;
}

/** Sex ratio expressed as share-male %. Neutral 50 when there is no population. */
export function sexRatioFromVector(v: AgeSexVector): number {
  const total = totalPopulation(v);
  if (total <= 0) return 50;
  let males = 0;
  for (let age = 0; age <= LAST_INDEX; age++) males += v.male[age] ?? 0;
  return (males / total) * 100;
}

/** Dependency ratio: (youth + senior) / working-age. 0 when no workforce. */
export function dependencyRatio(v: AgeSexVector): number {
  const work = workingAge(v);
  if (work <= 0) return 0;
  const g = coarseGroups(v);
  return (g.youth + g.senior) / work;
}
