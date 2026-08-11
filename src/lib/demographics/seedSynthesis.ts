/**
 * Seed pyramid synthesis (design §S4): turn the four coarse 18+ census age-shares
 * plus a median age, a birth-rate index, and a target population into a full
 * single-year age×sex vector. Pure (no DB, no randomness) so it is cheap to test
 * and to benchmark, and deterministic so re-seeding is idempotent.
 *
 * Method:
 *   1. Normalize the four adult shares to sum 1 (robust to census-style ints that
 *      sum to ~100 or fractions that sum to 1).
 *   2. Split the population into a 0-17 youth block and an 18+ adult block. The
 *      size of that block is SOLVED so the synthesized pyramid actually reports
 *      the seeded median age, bounded by a birth-rate-derived envelope (below).
 *   3. Distribute each adult band across its single years via an age-pyramid
 *      weight curve anchored to the median age; do the same for the youth block.
 *   4. Split every single year into male/female by the sex-ratio-at-age curve.
 * Total is preserved by construction (fractions + weights each sum to 1).
 */

import { AGE_BANDS, type AgeSexVector } from "./cohortVector";
import { agePyramidWeights, sexRatioAtAge } from "./sexRatioCurve";

export interface SeedSynthesisInput {
  /** Shares of the ADULT (18+) population. Accepts fractions (Σ≈1) or ints (Σ≈100). */
  adultShares: { young: number; mid: number; mature: number; senior: number };
  /** Target median age — the 0-17 block is SOLVED so the pyramid reports this. */
  medianAge: number;
  /** 0-100 index; sets the plausibility envelope the median-age solve is clamped into. */
  birthRate: number;
  population: number;
}

/**
 * 0-17 share of the total population implied by the birth-rate index alone.
 *
 * This is the PRIOR, not the answer: it anchors the plausibility envelope that
 * the median-age solve (below) is clamped into. Anchors: a very low birth rate
 * ⇒ ~12% under 18 (hyper-aged society, Japan 2020 ≈ 15%); a very high birth
 * rate ⇒ ~50% under 18. The old ceiling here was 0.35, which is a moderately
 * young MODERN society — it made a genuinely high-fertility pyramid
 * unrepresentable (Nigeria 1953 ≈ 48% under 18, Turkey 1953 ≈ 45%, Brazil 1953
 * ≈ 45%), so every high-fertility seed synthesized ~6-8 years too old.
 */
const YOUTH_FRACTION_MIN = 0.12;
const YOUTH_FRACTION_MAX = 0.5;

/**
 * How far the median-age solve is allowed to pull the youth block away from the
 * birth-rate prior, in points of total population.
 *
 * Median age and birth rate are two independent observations of the same age
 * structure, and seeds do not always author them consistently (1953 Turkey is
 * seeded with a median of 20 but a birth-rate index of 55, which on its own
 * implies a ~2.2 TFR — far below the real ~6.5). When they disagree we honour
 * the median as far as the birth rate plausibly allows, then stop: an unbounded
 * solve would let a single mis-authored median produce an absurd pyramid.
 */
const YOUTH_FRACTION_SLACK = 0.1;

/** Hard plausibility bounds on the 0-17 share of any national population. */
const YOUTH_FRACTION_FLOOR = 0.08; // beyond the most aged society ever recorded
const YOUTH_FRACTION_CEILING = 0.55; // Niger 2020 ≈ 0.52 is the observed maximum

const VECTOR_LENGTH = 101;
const LAST_INDEX = VECTOR_LENGTH - 1;

function zeroVector(): AgeSexVector {
  return {
    male: Array.from({ length: VECTOR_LENGTH }, () => 0),
    female: Array.from({ length: VECTOR_LENGTH }, () => 0),
  };
}

/**
 * Direction of within-band weight decay.
 * - "fromOldest": weights[i] is largest for the oldest year in the band
 *   (i=span maps to age=hi). Captures the 1962-1975 baby-boom tail at the
 *   top of the youth + young-adult bands.
 * - "fromYoungest": weights[i] is largest for the youngest year (i=0 maps
 *   to age=lo). Used for the 0-17 youth block where 0-4 fertility was
 *   higher than 15-17 (one-child policy biting) and for the 65+ senior
 *   block where the youngest seniors (65-70) outnumber the oldest (95+)
 *   due to mortality.
 */
export type PyramidDirection = "fromOldest" | "fromYoungest";

/** Distribute `bandPeople` across inclusive ages [lo,hi], splitting each year by sex. */
function fillBand(
  v: AgeSexVector,
  lo: number,
  hi: number,
  bandPeople: number,
  medianAge: number,
  direction: PyramidDirection = "fromYoungest"
) {
  if (bandPeople <= 0) return;
  const weights = agePyramidWeights(lo, hi, medianAge, direction);
  for (let i = 0; i < weights.length; i++) {
    const age = lo + i;
    const yearTotal = bandPeople * weights[i];
    const shareMale = sexRatioAtAge(age);
    v.male[age] += yearTotal * shareMale;
    v.female[age] += yearTotal * (1 - shareMale);
  }
}

/** Add a band's normalized weights into an age-indexed density array. */
function addBand(
  density: number[],
  lo: number,
  hi: number,
  mass: number,
  medianAge: number,
  direction: PyramidDirection
) {
  if (mass <= 0) return;
  const weights = agePyramidWeights(lo, hi, medianAge, direction);
  for (let i = 0; i < weights.length; i++) density[lo + i] += mass * weights[i];
}

/**
 * Grouped median of an age-indexed density, using the SAME convention as
 * `medianAgeFromVector` (each year centred on `age`, band [age-0.5, age+0.5)),
 * so solving against this hits the statistic the engine actually reports.
 */
function medianOfDensity(density: number[], total: number): number {
  const half = total / 2;
  let cumulative = 0;
  for (let age = 0; age <= LAST_INDEX; age++) {
    const inYear = density[age];
    if (cumulative + inYear >= half) {
      const into = inYear > 0 ? (half - cumulative) / inYear : 0;
      return Math.max(0, age - 0.5 + into);
    }
    cumulative += inYear;
  }
  return LAST_INDEX;
}

/**
 * Solve for the 0-17 share whose resulting pyramid reports `targetMedian`.
 *
 * The youth and adult SHAPES do not depend on the split (they are fixed by the
 * seeded median age and the census adult shares), so the combined density is
 * linear in the youth fraction and its median is monotonically DECREASING in it
 * — bisection converges without ever building a full age×sex vector. Outside
 * the attainable range the bisection saturates at the passed bound, which is
 * the closest achievable pyramid.
 */
function solveYouthFraction(
  youthShape: number[],
  adultShape: number[],
  targetMedian: number,
  lo: number,
  hi: number
): number {
  const combined = new Array<number>(VECTOR_LENGTH);
  const medianAt = (yf: number) => {
    for (let a = 0; a <= LAST_INDEX; a++)
      combined[a] = yf * youthShape[a] + (1 - yf) * adultShape[a];
    return medianOfDensity(combined, 1);
  };
  if (medianAt(lo) <= targetMedian) return lo;
  if (medianAt(hi) >= targetMedian) return hi;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 40; i++) {
    const mid = (a + b) / 2;
    if (medianAt(mid) > targetMedian) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

export function synthesizeAgeSexVector(input: SeedSynthesisInput): AgeSexVector {
  const { adultShares, medianAge, birthRate, population } = input;
  const v = zeroVector();
  if (!(population > 0)) return v;

  // 1. Normalize adult shares (robust to int-or-fraction input).
  const shareSum = adultShares.young + adultShares.mid + adultShares.mature + adultShares.senior;
  const norm =
    shareSum > 0
      ? {
          young: adultShares.young / shareSum,
          mid: adultShares.mid / shareSum,
          mature: adultShares.mature / shareSum,
          senior: adultShares.senior / shareSum,
        }
      : { young: 0.25, mid: 0.25, mature: 0.25, senior: 0.25 };

  // 2. Youth (0-17) vs adult (18+) split.
  //
  // The split is the DOMINANT determinant of the pyramid's median age — the
  // within-band decay curves only nudge it — so sizing it from the birth-rate
  // index alone left the seeded median age as a decorative input and made young
  // countries impossible to represent. Instead: take the birth-rate reading as a
  // prior, then SOLVE the split so the pyramid reports the seeded median age,
  // clamped to a band around that prior so a mis-authored median cannot run away.
  const br = Math.max(0, Math.min(100, birthRate)) / 100;
  const prior = YOUTH_FRACTION_MIN + br * (YOUTH_FRACTION_MAX - YOUTH_FRACTION_MIN);
  const lo = Math.max(YOUTH_FRACTION_FLOOR, prior - YOUTH_FRACTION_SLACK);
  const hi = Math.min(YOUTH_FRACTION_CEILING, prior + YOUTH_FRACTION_SLACK);

  const youthShape = new Array<number>(VECTOR_LENGTH).fill(0);
  addBand(youthShape, 0, AGE_BANDS.youthMax, 1, medianAge, "fromYoungest");
  const adultShape = new Array<number>(VECTOR_LENGTH).fill(0);
  addBand(
    adultShape,
    AGE_BANDS.youngMin,
    AGE_BANDS.midMin - 1,
    norm.young,
    medianAge,
    "fromOldest"
  );
  addBand(adultShape, AGE_BANDS.midMin, AGE_BANDS.matureMin - 1, norm.mid, medianAge, "fromOldest");
  addBand(
    adultShape,
    AGE_BANDS.matureMin,
    AGE_BANDS.seniorMin - 1,
    norm.mature,
    medianAge,
    "fromOldest"
  );
  addBand(adultShape, AGE_BANDS.seniorMin, LAST_INDEX, norm.senior, medianAge, "fromYoungest");

  const youthFraction =
    Number.isFinite(medianAge) && medianAge > 0
      ? solveYouthFraction(youthShape, adultShape, medianAge, lo, hi)
      : prior;
  const youthPeople = population * youthFraction;
  const adultPeople = population - youthPeople;

  // 3 + 4. Fill the youth block and each adult band, splitting by sex per year.
  // Direction per band:
  //   youth (0-17):  fromYoungest — 0-4 cohort is the largest (recent births),
  //                 15-17 is the smallest (one-child policy started biting in 1979).
  //   young (18-29): fromOldest   — 25-29 is the peak of the 1962-1975 baby boom.
  //   mid (30-44):   fromOldest   — 40-44 is the tail of the baby boom.
  //   mature (45-64): fromOldest  — 60-64 outnumbers 45-49 (pre-boom cohort).
  //   senior (65+):  fromYoungest — mortality culls the tail; 65-69 outnumbers 95+.
  fillBand(v, 0, AGE_BANDS.youthMax, youthPeople, medianAge, "fromYoungest");
  fillBand(
    v,
    AGE_BANDS.youngMin,
    AGE_BANDS.midMin - 1,
    adultPeople * norm.young,
    medianAge,
    "fromOldest"
  );
  fillBand(
    v,
    AGE_BANDS.midMin,
    AGE_BANDS.matureMin - 1,
    adultPeople * norm.mid,
    medianAge,
    "fromOldest"
  );
  fillBand(
    v,
    AGE_BANDS.matureMin,
    AGE_BANDS.seniorMin - 1,
    adultPeople * norm.mature,
    medianAge,
    "fromOldest"
  );
  fillBand(
    v,
    AGE_BANDS.seniorMin,
    VECTOR_LENGTH - 1,
    adultPeople * norm.senior,
    medianAge,
    "fromYoungest"
  );

  return v;
}
