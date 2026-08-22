/**
 * Reduce per-region derived boards to per-region TEXTURE: each family's
 * deviation from its country mean.
 *
 * Deviation, not level, because the playable countries' LEVELS are hand-authored
 * (NATIONAL_BASELINES_1953, from an approved design catalog) while their
 * per-region variation is missing. Deriving the level too would replace reviewed
 * balance with a mechanical inversion of outcome metrics -- on the US 1953 seeds
 * that puts economy.householdIncome at 0 against an authored 72.
 *
 * The cap is applied by SCALING, not clamping. Clamping a zero-mean vector
 * shifts its mean whenever the distribution is skewed, which would move the very
 * baseline this whole approach exists to preserve. Scaling honours the cap
 * exactly, keeps the mean at zero, and preserves rank ordering.
 *
 * The noise floor is the one thing that makes mean preservation APPROXIMATE
 * rather than exact: a family whose regions mostly sit near the mean drops those
 * small deviations and keeps only the outliers, so the survivors no longer sum
 * to zero. The worst realistic shape (50 flat regions, one outlier) moves the
 * country mean by under 0.25 points, which the test file pins. Do not restate
 * this as "exact".
 *
 * OFFLINE USE ONLY -- feeds a codegen script whose output is committed.
 */

/** Maximum |deviation| in points. Comparable to REGIONAL_MODIFIERS_1953 (-18..+8). */
export const TEXTURE_CAP = 12;

/** Deviations smaller than this are float noise, not texture. */
export const TEXTURE_NOISE_FLOOR = 0.5;

export function textureFromBoards(
  boards: Record<string, Record<string, number>>,
  /**
   * A (region, family) pair that will NOT receive texture -- currently the ones
   * a hand-authored REGIONAL_MODIFIERS_1953 entry already covers.
   *
   * Excluded BEFORE the mean is taken, not filtered out afterwards. Those pairs
   * are not randomly placed: an authored modifier exists precisely where the
   * seed author already knew a region was extreme, and the derivation agrees.
   * Centring over them and dropping afterwards removes a biased tail and shifts
   * the country mean -- 1.02 points on US society.integration when this was
   * done in the wrong order.
   */
  exclude?: (regionId: string, family: string) => boolean
): Record<string, Record<string, number>> {
  const regions = Object.keys(boards);
  const out: Record<string, Record<string, number>> = {};
  for (const region of regions) out[region] = {};

  const families = new Set<string>();
  for (const region of regions) {
    for (const family of Object.keys(boards[region])) families.add(family);
  }

  for (const family of families) {
    const present = regions.filter(
      (r) => Number.isFinite(boards[r][family]) && !exclude?.(r, family)
    );
    if (present.length === 0) continue;

    const mean = present.reduce((sum, r) => sum + boards[r][family], 0) / present.length;
    const deviations = new Map(present.map((r) => [r, boards[r][family] - mean]));

    const widest = Math.max(...[...deviations.values()].map(Math.abs));
    const scale = widest > TEXTURE_CAP ? TEXTURE_CAP / widest : 1;

    for (const [region, raw] of deviations) {
      const scaled = raw * scale;
      if (Math.abs(scaled) < TEXTURE_NOISE_FLOOR) continue;
      out[region][family] = scaled;
    }
  }

  for (const region of regions) {
    if (Object.keys(out[region]).length === 0) delete out[region];
  }
  return out;
}
