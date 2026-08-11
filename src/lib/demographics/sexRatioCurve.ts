/**
 * Sex-ratio-by-age curve and age-pyramid distribution shape (design §S4 inputs).
 *
 * Both are pure functions used by seed synthesis to turn coarse census shares
 * into a realistic single-year age×sex vector. No DB, no randomness.
 */

// Share-male at birth (~1.05 male:female) and in the deep old tail (female-majority).
const SHARE_MALE_BIRTH = 0.512;
const SHARE_MALE_OLD = 0.4;
// Logistic decline: stays near the birth ratio through young/mid adulthood, then
// falls through the old tail. Midpoint ~68 (crosses 0.5 in the mid-40s), gentle slope.
const SEX_RATIO_MIDPOINT = 68;
const SEX_RATIO_SLOPE = 12;

/**
 * Share of a given single-year age cohort that is male, in (0,1). Starts at
 * ~0.512 at birth, declines monotonically and smoothly, and is female-majority
 * (<0.5) in the old tail. Ages outside 0..100 clamp to the endpoints.
 */
export function sexRatioAtAge(age: number): number {
  const a = Math.max(0, Math.min(100, age));
  const span = SHARE_MALE_BIRTH - SHARE_MALE_OLD;
  return SHARE_MALE_OLD + span / (1 + Math.exp((a - SEX_RATIO_MIDPOINT) / SEX_RATIO_SLOPE));
}

// A younger median produces a steeper decline (more weight on the youngest years).
const PYRAMID_DECAY_NUMERATOR = 1.5;
const MIN_MEDIAN_AGE = 15;

/**
 * Normalized weights over the inclusive band [lo, hi]: `Σ = 1`, every weight ≥ 0.
 *
 * The 1962-1975 baby boom cohort (and similar demographic bulges) spans the
 * upper youth + lower young-adult bands. The per-band direction is configurable:
 * - `fromOldest`: weights decrease toward the youngest year (i=0), so the
 *   oldest year (i=span) holds the largest share. Captures the baby-boom tail
 *   at the top of the youth + young-adult bands.
 * - `fromYoungest`: weights decrease toward the oldest year, so the youngest
 *   year (i=0) holds the largest share. Used for the 0-17 youth block (where
 *   recent births outnumber teenagers) and the 65+ senior block (where the
 *   youngest seniors outnumber the oldest due to mortality).
 *
 * The magnitude of the decay is anchored to the band midpoint so a
 * single-parameter function handles all five bands uniformly.
 */
export function agePyramidWeights(
  lo: number,
  hi: number,
  medianAge: number,
  direction: "fromOldest" | "fromYoungest" = "fromYoungest"
): number[] {
  const span = hi - lo;
  if (span <= 0) return [1];
  const median = Math.max(MIN_MEDIAN_AGE, medianAge);
  // Decay rate: gentler for young bands (more uniform cohort), steeper for old
  // bands (mortality culls the tail). Anchored so a band of width ~17 with
  // midpoint at the median age gets a ~2:1 top-to-bottom ratio.
  const decay = (PYRAMID_DECAY_NUMERATOR / median) * 0.5;
  const raw: number[] = [];
  for (let i = 0; i <= span; i++) {
    // fromYoungest: i=0 (youngest) gets weight 1, i=span (oldest) gets exp(-d*span).
    // fromOldest:   i=0 (youngest) gets exp(-d*span), i=span (oldest) gets weight 1.
    const distFromMax = direction === "fromYoungest" ? i : span - i;
    raw.push(Math.exp(-decay * distFromMax));
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}
