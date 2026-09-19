/**
 * Romania's seven historic provinces, keyed by region code (= the game's
 * `states._id`). Ownership is read live from `states.countryId`. The shard
 * `public/ro-regions.json` is built by `scripts/maps/build-ro-geo.mjs`
 * (42 judete dissolved through one shared topology), features tagged
 * `properties.regionCode` plus the legacy `id`/`na` other surfaces read.
 * Same code set in the 1953 and 1979 presets — one shard, no era variant.
 */
export const RO_GEO_URL = "/ro-regions.json";

export const RO_REGION_CODES = [
  "RO_BUC",
  "RO_DOB",
  "RO_MOL",
  "RO_MUN",
  "RO_OLT",
  "RO_TRA",
  "RO_VST",
] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const RO_LABEL_OVERRIDES: Record<string, string> = {
  RO_BUC: "Buc.",
  RO_VST: "Banat",
  RO_TRA: "Transylvania",
};

export function isRomaniaRegion(code: string): boolean {
  return (RO_REGION_CODES as readonly string[]).includes(code);
}
