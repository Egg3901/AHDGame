import type { CountryId } from "@/lib/constants/countries";
import { workingAgePopulation, type AgeSexVector } from "./cohortVector";

export interface ConscriptionOption {
  label: string;
  inductionRate: number; // fraction of each entering band cohort actually taken (<1)
  serviceTerm: number; // years served
}

/**
 * The 7-option Recruitment / National Service ladder (design §4.5.1/§4.5.2).
 * inductionRate × fitnessRate × min(serviceTerm,bandWidth)/bandWidth sets the
 * actively-serving fraction; serviceTerm caps the active force (F-1) so even the
 * top rung tops out near the ~2.5%-of-labor ceiling.
 */
export const CONSCRIPTION_OPTIONS: ConscriptionOption[] = [
  { label: "Conscientious Objector", inductionRate: 0, serviceTerm: 0 },
  { label: "Volunteer Force", inductionRate: 0.03, serviceTerm: 1 },
  { label: "Recruitment Incentives", inductionRate: 0.05, serviceTerm: 1 },
  { label: "Balanced", inductionRate: 0.05, serviceTerm: 1 },
  { label: "Expanded Forces", inductionRate: 0.1, serviceTerm: 1.5 },
  { label: "Draft Activated", inductionRate: 0.35, serviceTerm: 1.5 },
  { label: "National Service", inductionRate: 0.7, serviceTerm: 2 },
];

/** Fraction of an inducted cohort that is actually fit/available to serve. */
export const CONSCRIPTION_FITNESS_RATE = 0.65;
/** Hard realism ceiling: active force never exceeds this fraction of labor (§4.5.2). */
export const CONSCRIPTION_CEILING_FRACTION = 0.025;

const MIN_BAND = 18;
const MAX_BAND = 29;

export interface ConscriptionPolicy {
  eligibleBand: [number, number];
  sexEnabled: { male: boolean; female: boolean };
  option: number; // 1..7 (index+1 into CONSCRIPTION_OPTIONS)
}

/** Per-country seed rung (§4.5.4) — a starting point, NOT a ceiling. */
const CONSCRIPTION_SEED: Partial<Record<CountryId, ConscriptionPolicy>> = {
  US: { eligibleBand: [18, 20], sexEnabled: { male: true, female: false }, option: 2 },
  UK: { eligibleBand: [18, 20], sexEnabled: { male: true, female: false }, option: 2 },
  DE: { eligibleBand: [18, 20], sexEnabled: { male: true, female: false }, option: 1 }, // suspended
  JP: { eligibleBand: [18, 20], sexEnabled: { male: true, female: false }, option: 2 },
  IE: { eligibleBand: [18, 20], sexEnabled: { male: true, female: false }, option: 2 },
  BR: { eligibleBand: [18, 20], sexEnabled: { male: true, female: false }, option: 5 },
  CN: { eligibleBand: [18, 22], sexEnabled: { male: true, female: false }, option: 6 },
  NG: { eligibleBand: [18, 20], sexEnabled: { male: true, female: false }, option: 2 },
};
const DEFAULT_POLICY: ConscriptionPolicy = {
  eligibleBand: [18, 20],
  sexEnabled: { male: true, female: false },
  option: 2,
};

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * Resolve a country's conscription policy from its seed rung, with an optional
 * override (the future Recruitment/National Service Act law / bill UI writes it).
 * Band clamped to [18,29]; option clamped to 1..7.
 */
export function resolveConscriptionPolicy(
  countryId: CountryId,
  override: Partial<ConscriptionPolicy> | undefined
): ConscriptionPolicy {
  const base = CONSCRIPTION_SEED[countryId] ?? DEFAULT_POLICY;
  const band = override?.eligibleBand ?? base.eligibleBand;
  const lo = clampInt(band[0], MIN_BAND, MAX_BAND);
  const hi = clampInt(band[1], lo, MAX_BAND);
  return {
    eligibleBand: [lo, hi],
    sexEnabled: override?.sexEnabled ?? base.sexEnabled,
    option: clampInt(override?.option ?? base.option, 1, 7),
  };
}

export interface ConscriptionEffects {
  activeServingPop: number; // servingMale + servingFemale (withdrawn from labor)
  servingMale: number;
  servingFemale: number;
  /** Per-age (0..100) serving women within [18..44] — removed from the childbearing pool. */
  servingFemaleByAge: number[];
  laborForceDelta: number; // −activeServingPop (handed to P1c's L; §4.5.3)
  /** Estimates for the FUTURE bill preview / governance metrics (not yet persisted). */
  reserveInflowPerYear: number;
  readinessEstimate: number; // 0-100-ish, manpower-driven (greenfield metric consumer)
  nationalPrideEstimate: number; // 0-100-ish, rung-driven
}

const CHILDBEARING_LO = 18;
const CHILDBEARING_HI = 44;

/**
 * SSOT (§4.5.5): the bill preview AND the turn engine both call this. Computes the
 * actively-serving slice of the age×sex vector with the F-1 serviceTerm cap and
 * the hard ~2.5%-of-labor ceiling, sex-decomposed (N3/audit-3): the female serving
 * sub-count in [18..44] is returned per-age for the fertility (childbearing-pool)
 * subtraction; the total is the labor withdrawal. Serving people are NOT removed
 * from the population vector — they return after service.
 */
export function estimateConscriptionEffects(
  policy: ConscriptionPolicy,
  vector: AgeSexVector
): ConscriptionEffects {
  const opt = CONSCRIPTION_OPTIONS[clampInt(policy.option, 1, 7) - 1];
  const [lo, hi] = policy.eligibleBand;
  const bandWidth = Math.max(1, hi - lo + 1);
  const activeFraction =
    opt.inductionRate *
    CONSCRIPTION_FITNESS_RATE *
    (Math.min(opt.serviceTerm, bandWidth) / bandWidth);

  const servingFemaleByAge = new Array<number>(101).fill(0);
  let servingMale = 0;
  let servingFemale = 0;
  for (let a = lo; a <= hi; a++) {
    if (policy.sexEnabled.male) servingMale += (vector.male[a] ?? 0) * activeFraction;
    if (policy.sexEnabled.female) {
      const f = (vector.female[a] ?? 0) * activeFraction;
      servingFemale += f;
      if (a >= CHILDBEARING_LO && a <= CHILDBEARING_HI) servingFemaleByAge[a] = f;
    }
  }

  // Hard ceiling on the active force (realism guard, §4.5.2): scale both sexes down
  // proportionally if the computed force exceeds the cap.
  let activeServingPop = servingMale + servingFemale;
  const ceiling = CONSCRIPTION_CEILING_FRACTION * workingAgePopulation(vector);
  if (activeServingPop > ceiling && activeServingPop > 0) {
    const scale = ceiling / activeServingPop;
    servingMale *= scale;
    servingFemale *= scale;
    for (let a = 0; a <= 100; a++) servingFemaleByAge[a] *= scale;
    activeServingPop = ceiling;
  }

  // Reserve INFLOW estimate (people completing service per year) — feeds the future
  // readiness metric (reserve stock + decay land with that metric, §4.5.3 audit-6).
  const annualIntake = activeServingPop / Math.max(1, opt.serviceTerm || 1);
  return {
    activeServingPop,
    servingMale,
    servingFemale,
    servingFemaleByAge,
    laborForceDelta: -activeServingPop,
    reserveInflowPerYear: annualIntake,
    readinessEstimate: Math.min(100, 50 + (activeServingPop / Math.max(1, ceiling)) * 40),
    nationalPrideEstimate: Math.min(100, 50 + (policy.option >= 3 ? policy.option * 3 : 0)),
  };
}
