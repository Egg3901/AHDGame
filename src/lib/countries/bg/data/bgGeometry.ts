/**
 * Bulgaria's three macro-regions (Sofia basin, Danubian Plain, Thrace), keyed
 * by region code (= the game's `states._id`). Ownership is read live from
 * `states.countryId`. The shard `public/bg-regions.json` is built by
 * `scripts/maps/build-bg-geo.mjs` (BGR provinces dissolved through one
 * topology), features tagged `properties.regionCode` plus the legacy `id`/`na`
 * other surfaces read. Same code set in the 1953 and 1979 presets — one
 * shard, no era variant.
 */
export const BG_GEO_URL = "/bg-regions.json";

export const BG_REGION_CODES = ["BG_COA", "BG_NOR", "BG_SOF", "BG_SW", "BG_THR"] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const BG_LABEL_OVERRIDES: Record<string, string> = {
  BG_NOR: "North",
  BG_SOF: "Sofia",
  BG_COA: "Coast",
  BG_SW: "SW",
};

export function isBulgariaRegion(code: string): boolean {
  return (BG_REGION_CODES as readonly string[]).includes(code);
}
