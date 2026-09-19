/**
 * Spain's eight macro-regions, keyed by region code (= the game's
 * `states._id`). Ownership is read live from `states.countryId`. The shard
 * `public/es-regions.json` is built by `scripts/maps/build-es-geo.mjs`
 * (autonomous communities dissolved through one shared topology), features
 * tagged `properties.regionCode` plus the legacy `id`/`na` other surfaces
 * read. Same code set in the 1953 and 1979 presets — one shard, no era
 * variant. The Canary Islands belong to ES_CEN in seed data but are excluded
 * from the geometry (they sit at 18°W and would shrink the mainland to half
 * the map fit); Ceuta/Melilla are excluded as sub-pixel exclaves.
 */
export const ES_GEO_URL = "/es-regions.json";

export const ES_REGION_CODES = [
  "ES_AND",
  "ES_CAT",
  "ES_CEN",
  "ES_GAL",
  "ES_MAD",
  "ES_NOR",
  "ES_PVB",
  "ES_VAL",
] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const ES_LABEL_OVERRIDES: Record<string, string> = {
  ES_VAL: "Valencia",
  ES_PVB: "Basque",
  ES_CEN: "C. Spain",
  ES_NOR: "N. Spain",
};

export function isSpainRegion(code: string): boolean {
  return (ES_REGION_CODES as readonly string[]).includes(code);
}
