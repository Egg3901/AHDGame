import { deriveRegionLeans } from "./deriveRegionLeans";
import type { EraId } from "@/lib/seeds/presetSelector";

/**
 * How independent a country's two policy axes actually are, across its regions.
 *
 * Populating both axes is not enough for two-axis geography. If a region's
 * economic and social leans are perfectly correlated, the two axes are the same
 * variable twice: `policyDistanceDriver` still only distinguishes candidates
 * along one direction, and a social position can never be a genuine trade-off
 * against an economic one. Correlation near ±1 means the geography is 1-D no
 * matter how wide each axis spreads.
 *
 * Measured on the current models (#3760):
 *   UK 1979  0.42   UK 2019 -0.64   — genuinely two-dimensional
 *   US 2019  0.99   JP 2019  0.99   — effectively one-dimensional
 *
 * Japan cannot do better from its census: across its eight regions, urban,
 * senior, university and high-income all move together at |r| > 0.85, so the
 * data has only one degree of freedom to express. Fixing that is a census
 * problem, not a positions problem.
 */
export function axisCorrelation(country: string, era: EraId): number | null {
  const rows = deriveRegionLeans(country, era);
  if (rows.length < 3) return null;
  const e = rows.map((r) => r.economic);
  const s = rows.map((r) => r.social);
  const n = e.length;
  const me = e.reduce((a, b) => a + b, 0) / n;
  const ms = s.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let de = 0;
  let ds = 0;
  for (let i = 0; i < n; i++) {
    num += (e[i] - me) * (s[i] - ms);
    de += (e[i] - me) ** 2;
    ds += (s[i] - ms) ** 2;
  }
  if (de === 0 || ds === 0) return null;
  return num / Math.sqrt(de * ds);
}

/** Regions whose two axes point opposite ways — the mark of real 2-D structure. */
export function mixedSignRegions(country: string, era: EraId): string[] {
  return deriveRegionLeans(country, era)
    .filter(
      (r) => r.economic !== 0 && r.social !== 0 && Math.sign(r.economic) !== Math.sign(r.social)
    )
    .map((r) => r.regionId);
}
