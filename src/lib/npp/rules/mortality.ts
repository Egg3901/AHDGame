/**
 * Under V5, seated NPPs age each game year and can die; successors inherit seats.
 * These pure calculations use the supplied year, turn count, and RNG, with no database access.
 * @see nppDiesThisTurn
 */

export interface NppMortalityEligibilityInput {
  birthYear?: number | null;
  isTechnocrat?: boolean;
  currentOffice?: unknown | null;
  retiredAt?: Date | null;
}

export function isEligibleNppForMortality(npp: NppMortalityEligibilityInput): boolean {
  return (
    npp.retiredAt == null &&
    npp.birthYear != null &&
    Number.isFinite(npp.birthYear) &&
    npp.isTechnocrat !== true &&
    npp.currentOffice != null
  );
}

/** Age in whole game years. Null means the birth year is not recorded. */
export function nppAgeAtYear(
  npp: Pick<NppMortalityEligibilityInput, "birthYear">,
  year: number
): number | null {
  if (npp.birthYear == null || !Number.isFinite(npp.birthYear)) return null;
  return year - npp.birthYear;
}

/** Annual death probability for a sitting politician at the supplied age. */
export function annualDeathProbability(age: number): number {
  if (!Number.isFinite(age) || age < 0) return 0;
  const p = 0.00005 * Math.exp(0.095 * age);
  return Math.min(p, 0.5);
}

/** Roll one turn of mortality using an injected RNG and turns-per-year value. */
export function nppDiesThisTurn(age: number, rng: () => number, turnsPerYear: number): boolean {
  if (!Number.isFinite(turnsPerYear) || turnsPerYear <= 0) return false;
  return rng() < annualDeathProbability(age) / turnsPerYear;
}

/** Generate a working-age replacement birth year from an injected RNG. */
export function randomReplacementBirthYear(currentYear: number, rng: () => number): number {
  const age = 32 + Math.floor(rng() * 37);
  return currentYear - age;
}
