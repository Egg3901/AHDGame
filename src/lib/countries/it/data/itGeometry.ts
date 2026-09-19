/**
 * Italy's eight macro-regions, keyed by region code (= the game's
 * `states._id`). Ownership is read live from `states.countryId`. The shard
 * `public/it-regions.json` is built by `scripts/maps/build-it-geo.mjs`
 * (20 ADM1 regions dissolved through one shared topology), features tagged
 * `properties.regionCode` plus the legacy `id`/`na` other surfaces read.
 * Same code set in the 1953 and 1979 presets — one shard, no era variant.
 * The set is the ISTAT macro-areas with Lazio and Campania carved out of
 * Center and South respectively (matching src/lib/seeds/it/itRegions.ts).
 */
export const IT_GEO_URL = "/it-regions.json";

export const IT_REGION_CODES = [
  "IT_CAM",
  "IT_LAZ",
  "IT_NE",
  "IT_NW",
  "IT_SAR",
  "IT_SIC",
  "IT_SUD",
  "IT_TUS",
] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const IT_LABEL_OVERRIDES: Record<string, string> = {
  IT_TUS: "C. Italy",
  IT_SUD: "S. Italy",
};

export function isItalyRegion(code: string): boolean {
  return (IT_REGION_CODES as readonly string[]).includes(code);
}
