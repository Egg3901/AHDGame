/**
 * The China macro-region geometry, keyed by region code (= the game's `states._id`).
 * Seven stable macro-regions; ownership is read live from `states.countryId`.
 *
 * China is era-aware in GEOMETRY, not in region set: the Hong Kong / Macau handover
 * (1997) changes the *shape* of the southern region (`HN`, Huanan) but adds no
 * region. So both era shards carry the identical seven codes and the renderer
 * selects the era-correct `sourceUrl` by game time — it is NOT ownership-gated.
 * See {@link isPreHKHandover} in countryMapConfigs.
 *
 * Shards `public/cn-regions.json` (modern) and `public/cn-regions-1991.json`
 * (pre-handover) are tagged `properties.regionCode` by
 * `scripts/maps/tag-region-shard.mjs`, keeping the legacy `id`/`na` that
 * `RegionMapPaths` still reads on other surfaces.
 */
export const CHINA_GEO_URL = "/cn-regions.json";
export const CHINA_GEO_URL_PRE_HANDOVER = "/cn-regions-1991.json";

export const CN_REGION_CODES = ["DB", "HB", "HD", "HN", "HZ", "XB", "XN"] as const;

export function isChinaRegion(code: string): boolean {
  return (CN_REGION_CODES as readonly string[]).includes(code);
}
