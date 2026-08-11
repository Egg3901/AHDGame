import type { AgeSexVector } from "../cohortVector";
import { sexRatioAtAge } from "../sexRatioCurve";

const FERTILE_MIN = 18;
const FERTILE_MAX = 44;
const ASFR_PEAK = 28;
const ASFR_SIGMA = 6;

// Precompute the normalized age-specific fertility weights (Σ = 1 over 18..44).
const ASFR_WEIGHTS: number[] = (() => {
  const raw: number[] = [];
  for (let a = FERTILE_MIN; a <= FERTILE_MAX; a++) {
    raw.push(Math.exp(-0.5 * ((a - ASFR_PEAK) / ASFR_SIGMA) ** 2));
  }
  const sum = raw.reduce((x, y) => x + y, 0);
  return raw.map((w) => w / sum);
})();

/** Age-specific fertility weight, normalized Σ=1 over 18..44, 0 elsewhere (audit-C1/audit-2). */
export function asfrWeight(age: number): number {
  if (age < FERTILE_MIN || age > FERTILE_MAX) return 0;
  return ASFR_WEIGHTS[age - FERTILE_MIN];
}

/**
 * Map the 0-100 `birthRate` index to a total-fertility rate (births per woman),
 * anchored so index 50 = the supplied replacement TFR (preset-specific; audit).
 *
 * Piecewise linear: the lower half (0-50) preserves the original mapping so
 * every existing seed below replacement is unchanged. The upper half (50-100)
 * is steeper so index 100 maps to ≈3.4×replacementTFR (≈7.0 TFR at the
 * standard 2.06 anchor), letting the model express real mid-century high
 * fertility (Turkey, Nigeria, India, etc.) that was previously unreachable.
 */
export function birthRateIndexToTFR(index: number, replacementTFR: number): number {
  const i = Math.max(0, Math.min(100, index));
  if (i <= 50) {
    // Original linear: 0 → 0.4×replacement, 50 → 1.0×replacement.
    return replacementTFR * (0.4 + (i / 50) * 0.6);
  }
  // Extended: 50 → 1.0×replacement, 100 → 3.4×replacement (≈7.0 TFR at 2.06 anchor).
  return replacementTFR * (1.0 + ((i - 50) / 50) * 2.4);
}

/**
 * Per-turn newborns (design §4.2 canonical form):
 *   births = TFR · Σ_a women[a]·asfrWeight(a) / TURNS_PER_YEAR.
 * `asfrWeight` is normalized (Σ=1) so it ALREADY absorbs the /reproductive-span
 * divisor — do NOT double-divide. The female slice is used directly (no ½
 * both-sex proxy).
 */
export function computeBirths(
  vector: AgeSexVector,
  fertilityRate: number,
  turnsPerYear: number,
  servingFemaleByAge?: number[]
): number {
  let weightedWomen = 0;
  for (let a = FERTILE_MIN; a <= FERTILE_MAX; a++) {
    // Women in mandatory service delay family formation — excluded from the
    // childbearing pool (conscription, §4.5.3). They stay in the population vector.
    const inService = servingFemaleByAge ? (servingFemaleByAge[a] ?? 0) : 0;
    const available = Math.max(0, (vector.female[a] ?? 0) - inService);
    weightedWomen += available * asfrWeight(a);
  }
  // TFR = lifetime births per woman over the whole span; the normalized weight
  // distributes it, so annual births = TFR · weightedWomen, then /turnsPerYear.
  return Math.max(0, (fertilityRate * weightedWomen) / turnsPerYear);
}

/** Split newborns into male/female by the sex ratio at birth (~1.05 M:F). */
export function splitNewbornsBySex(newborns: number): { male: number; female: number } {
  const shareMale = sexRatioAtAge(0);
  return { male: newborns * shareMale, female: newborns * (1 - shareMale) };
}
