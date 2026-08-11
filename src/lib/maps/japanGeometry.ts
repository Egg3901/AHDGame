/**
 * The Japan macro-region geometry, keyed by region code (= the game's `states._id`).
 * Eight stable macro-regions; ownership is read live from `states.countryId`.
 *
 * The shard `public/japan-regions.json` is BUILT by
 * `scripts/maps/build-japan-geo.mjs`, which dissolves the 47 prefectures of
 * `japan-prefectures.json` into these 8 regions (the same grouping `JapanMapPaths`
 * does at runtime) and tags each feature `properties.regionCode`. Rebuild the
 * shard if the prefecture→region grouping ever changes.
 */
export const JAPAN_GEO_URL = "/japan-regions.json";

export const JP_REGION_CODES = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"] as const;

export function isJapanRegion(code: string): boolean {
  return (JP_REGION_CODES as readonly string[]).includes(code);
}
