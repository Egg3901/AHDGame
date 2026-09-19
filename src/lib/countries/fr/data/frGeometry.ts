/**
 * France's eight macro-regions, keyed by region code (= the game's
 * `states._id`). Ownership is read live from `states.countryId`. The shard
 * `public/fr-regions.json` is built by `scripts/maps/build-fr-geo.mjs`
 * (96 metropolitan departments dissolved through one shared topology),
 * features tagged `properties.regionCode` plus the legacy `id`/`na` other
 * surfaces read. Same code set in the 1953 and 1979 presets — one shard, no
 * era variant. The macro-regions group the pre-1982 régions (composition
 * back-solved from the 1979 seed populations in frRegions.ts).
 */
export const FR_GEO_URL = "/fr-regions.json";

export const FR_REGION_CODES = [
  "FR_ARA",
  "FR_CEN",
  "FR_EST",
  "FR_IDF",
  "FR_MED",
  "FR_NOR",
  "FR_OUE",
  "FR_SOU",
] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const FR_LABEL_OVERRIDES: Record<string, string> = {
  FR_IDF: "IDF",
  FR_ARA: "Rhône-Alpes",
  FR_MED: "Med.",
};

export function isFranceRegion(code: string): boolean {
  return (FR_REGION_CODES as readonly string[]).includes(code);
}
