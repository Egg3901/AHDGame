import type { AgeSexVector } from "./cohortVector";
import {
  applyMortality,
  healthcareMortalityModifier,
  type HealthcareInputs,
} from "./flows/mortality";
import { birthRateIndexToTFR, computeBirths, splitNewbornsBySex } from "./flows/fertility";
import { applyContinuousAging } from "./flows/aging";
import { applyInternationalMigration, migrantAgeSexProfile } from "./flows/internationalMigration";

export interface CohortInputs {
  /** Preset-specific replacement TFR anchoring the index→TFR map (audit). */
  replacementTFR: number;
  /** `population.birthRate` metric, 0-100 index. */
  birthRateIndex: number;
  healthcare: HealthcareInputs;
  /** National international NET migrants allocated to THIS region this turn (may be <0). */
  netInternationalMigrants: number;
  /** Sex skew of the migrant corridor (0.5 balanced). */
  migrantShareMale: number;
  /**
   * Per-age (0..100) women in mandatory military service — excluded from the
   * childbearing pool in the fertility flow (conscription, §4.5.3). Optional;
   * absent = no conscription effect.
   */
  servingFemaleByAge?: number[];
}

export interface CohortFlowTallies {
  births: number;
  deaths: number;
  netMigration: number;
}

/**
 * Advance one region's age×sex vector by one turn (design §4.2). Order:
 * continuous aging (EVERY turn — 1/turnsPerYear of each cohort graduates up,
 * smoothing the age structure) → mortality → fertility (newborns into age 0) →
 * international migration. All flows per-cell non-negative; international net may
 * change the headcount. `turn` is retained for signature stability / future use
 * (continuous aging no longer gates on it). No cross-region coupling (internal
 * migration is P1b-2).
 */
export function advanceCohort(
  vector: AgeSexVector,
  inputs: CohortInputs,
  turn: number,
  turnsPerYear: number
): { vector: AgeSexVector; flows: CohortFlowTallies } {
  void turn; // continuous aging is applied every turn; no boundary gate
  // Aging first (graduates the existing stock; fertility refills age 0 below).
  let v = applyContinuousAging(vector, turnsPerYear);

  // Mortality.
  const modifier = healthcareMortalityModifier(inputs.healthcare);
  const mort = applyMortality(v, modifier, turnsPerYear);
  v = mort.survivors;

  // Fertility → newborns into age 0 (split by sex at birth).
  const tfr = birthRateIndexToTFR(inputs.birthRateIndex, inputs.replacementTFR);
  const births = computeBirths(v, tfr, turnsPerYear, inputs.servingFemaleByAge);
  const { male, female } = splitNewbornsBySex(births);
  v = { male: v.male.slice(), female: v.female.slice() };
  v.male[0] = (v.male[0] ?? 0) + male;
  v.female[0] = (v.female[0] ?? 0) + female;

  // International migration.
  const profile = migrantAgeSexProfile(inputs.migrantShareMale);
  const mig = applyInternationalMigration(v, inputs.netInternationalMigrants, profile);
  v = mig.vector;

  return { vector: v, flows: { births, deaths: mort.deaths, netMigration: mig.applied } };
}
