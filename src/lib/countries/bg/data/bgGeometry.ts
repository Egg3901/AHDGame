/**
 * Bulgaria's historical five-region and 2027 six-region map shards, keyed by
 * the game's `states._id`. Ownership is read live from `states.countryId`.
 * `scripts/geo/build-bg-geo.mjs` dissolves the province boundaries into both
 * sets. Features carry `properties.regionCode` and the legacy `id`/`na` fields.
 */
export const BG_GEO_URL = "/bg-regions.json";
export const BG_GEO_URL_2027 = "/bg-regions-2027.json";

export const BG_REGION_CODES = ["BG_COA", "BG_NOR", "BG_SOF", "BG_SW", "BG_THR"] as const;
export const BG_REGION_CODES_2027 = ["BG31", "BG32", "BG33", "BG34", "BG41", "BG42"] as const;

/** Select the shard from live state IDs, so historic saves retain their map. */
export function bgGeoUrlForRegions(codes: readonly string[]): string {
  return codes.some((code) => (BG_REGION_CODES_2027 as readonly string[]).includes(code))
    ? BG_GEO_URL_2027
    : BG_GEO_URL;
}

/** Compact on-map labels — the long names overflow the small map tiles. */
export const BG_LABEL_OVERRIDES: Record<string, string> = {
  BG_NOR: "North",
  BG_SOF: "Sofia",
  BG_COA: "Coast",
  BG_SW: "SW",
};

export function isBulgariaRegion(code: string): boolean {
  return (
    (BG_REGION_CODES as readonly string[]).includes(code) ||
    (BG_REGION_CODES_2027 as readonly string[]).includes(code)
  );
}
