/**
 * Nigeria's six geopolitical zones, keyed by region code (= the game's
 * `states._id`). Ownership is read live from `states.countryId`. The shard
 * `public/ng-regions.json` is tagged `properties.regionCode` by
 * `scripts/maps/tag-region-shard.mjs`, keeping the legacy `id`/`na` that other
 * surfaces still read.
 */
export const NIGERIA_GEO_URL = "/ng-regions.json";

export const NG_REGION_CODES = [
  "NORTH_WEST",
  "NORTH_EAST",
  "NORTH_CENTRAL",
  "SOUTH_WEST",
  "SOUTH_SOUTH",
  "SOUTH_EAST",
] as const;

export function isNigeriaRegion(code: string): boolean {
  return (NG_REGION_CODES as readonly string[]).includes(code);
}
