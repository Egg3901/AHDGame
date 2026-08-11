/**
 * Working-age band thresholds for the labor force / income-tax base. A FUTURE law
 * can change them via `gameState.workingAgeEligible` / `gameState.retirementAgeEligible`
 * (per-world). The cohort engine writes the working-age population (Σ ages in
 * [workingAgeEligible, retirementAgeEligible)); the P1c GDP engine consumes it as
 * the labor force `L` (design §5.1), which is the (non-double-counting) channel
 * through which working age modulates income tax. Clamped to sane bands.
 */
export const DEFAULT_WORKING_AGE = 18;
export const DEFAULT_RETIREMENT_AGE = 64;
const MIN_WORKING_AGE = 16;
const MAX_WORKING_AGE = 25;
const MIN_RETIREMENT_AGE = 50;
const MAX_RETIREMENT_AGE = 75;

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

export function resolveWorkingAgeEligible(
  source: { workingAgeEligible?: number } | undefined
): number {
  return clampInt(
    source?.workingAgeEligible,
    MIN_WORKING_AGE,
    MAX_WORKING_AGE,
    DEFAULT_WORKING_AGE
  );
}

export function resolveRetirementAgeEligible(
  source: { retirementAgeEligible?: number } | undefined
): number {
  return clampInt(
    source?.retirementAgeEligible,
    MIN_RETIREMENT_AGE,
    MAX_RETIREMENT_AGE,
    DEFAULT_RETIREMENT_AGE
  );
}
