import type { AgeSexVector } from "../cohortVector";

/**
 * Per-age annual mortality schedule (design §4.2 mortality detail). Gompertz-like
 * rise with age, sex-specific (female below male at every age → female-majority
 * old tail), with the single `ages[100]` terminal calibrated to the real ~35-50%/yr
 * 100+ rate (audit-C2) so the centenarian tail does not accrue. These are the
 * STRUCTURAL base rates; healthcare policy bends them via the modifier below.
 *
 * Constants are starting values; the stationarity __sim__ (P1b-1 Task 6) tunes
 * them so a replacement-TFR population lands flat with a realistic over-65 share.
 */
// Calibrated to real period life-table levels (male): age 65 ≈1.2%/yr, 85 ≈11%,
// 95 ≈32%, capped at the 100+ terminal. Tuned (Task 6 stationarity) so a
// replacement-TFR population lands flat with a realistic over-65 share.
const GOMPERTZ_A = 9.4e-6; // baseline hazard scale (male)
const GOMPERTZ_B = 0.11; // age slope
const INFANT_FLOOR = 0.0004; // keeps 0-17 ~0.05%/yr rather than ~0
const FEMALE_FACTOR = 0.78; // female ≈ 0.7-0.85× male at every age
const MORTALITY_CAP = 0.55; // 100+ terminal (audit-C2); curve is monotonic up to it
const TERMINAL_AGE = 100;

export function perAgeMortality(sex: "male" | "female", age: number): number {
  const a = Math.max(0, Math.min(TERMINAL_AGE, age));
  const sexFactor = sex === "female" ? FEMALE_FACTOR : 1;
  const hazard = GOMPERTZ_A * Math.exp(GOMPERTZ_B * a) + INFANT_FLOOR;
  // Cap at the 100+ terminal — monotonic non-decreasing, then flat at the cap.
  return Math.min(MORTALITY_CAP, hazard) * sexFactor;
}

export interface HealthcareInputs {
  lifeExpectancy?: number; // YEARS (realistic span ~70-85), ↑ → ↓ deaths
  preventableMortality?: number; // per 100k (realistic span ~120-500), ↑ → ↑ deaths
}

const MODIFIER_MIN = 0.7;
const MODIFIER_MAX = 1.4;

// Realistic spans (THRESHOLDS best/worst from metricScoring): each metric
// contributes ±MAX_EFFECT at its extremes, 0 at the mid. The earlier 0-100/
// centered-50 mapping mis-read the REAL units — lifeExpectancy is YEARS and
// preventableMortality per-100k (seeded 110-320), which pegged the modifier at
// the 1.4 clamp once S1 un-clamped the metric to its true scale (P2b Task 0a).
export const LIFE_EXPECTANCY_MID = 77.5; // (70+85)/2 — neutral default (years)
export const LIFE_HALF_SPAN = 7.5;
export const PREVENTABLE_MORTALITY_MID = 310; // (120+500)/2 — neutral default (per 100k)
export const PREV_HALF_SPAN = 190;
const MAX_EFFECT = 0.3;

const centered = (v: number, mid: number, halfSpan: number): number =>
  Math.max(-1, Math.min(1, (v - mid) / halfSpan));

/**
 * Healthcare policy modifier on mortality, clamped to [0.7,1.4] (policy bends
 * mortality, never abolishes it). Inputs are in REAL metric units (years /
 * per-100k); mid-range healthcare → ~1.0; missing metrics default to the mid.
 */
export function healthcareMortalityModifier(h: HealthcareInputs): number {
  const life = Number.isFinite(h.lifeExpectancy)
    ? (h.lifeExpectancy as number)
    : LIFE_EXPECTANCY_MID;
  const prev = Number.isFinite(h.preventableMortality)
    ? (h.preventableMortality as number)
    : PREVENTABLE_MORTALITY_MID;
  const lifeEffect = -centered(life, LIFE_EXPECTANCY_MID, LIFE_HALF_SPAN) * MAX_EFFECT; // longer life → fewer deaths
  const prevEffect = centered(prev, PREVENTABLE_MORTALITY_MID, PREV_HALF_SPAN) * MAX_EFFECT; // more preventable deaths → more deaths
  const raw = 1 + lifeEffect + prevEffect;
  return Math.max(MODIFIER_MIN, Math.min(MODIFIER_MAX, raw));
}

/** Apply one turn of mortality. Returns the survivor vector + total deaths. */
export function applyMortality(
  vector: AgeSexVector,
  modifier: number,
  turnsPerYear: number
): { survivors: AgeSexVector; deaths: number } {
  const survivors: AgeSexVector = { male: new Array(101), female: new Array(101) };
  let deaths = 0;
  for (const sex of ["male", "female"] as const) {
    for (let a = 0; a <= 100; a++) {
      const pop = vector[sex][a] ?? 0;
      const rate = (perAgeMortality(sex, a) * modifier) / turnsPerYear;
      const died = Math.min(pop, pop * rate); // never more than the cohort
      survivors[sex][a] = pop - died;
      deaths += died;
    }
  }
  return { survivors, deaths };
}
