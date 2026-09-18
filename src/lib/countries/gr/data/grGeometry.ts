/**
 * Greece's six macro-regions, keyed by region code (= the game's
 * `states._id`). Ownership is read live from `states.countryId`. The shard
 * `public/gr-regions.json` is built by `scripts/maps/build-gr-geo.mjs`
 * (14 peripheries dissolved through one shared topology), features tagged
 * `properties.regionCode` plus the legacy `id`/`na` other surfaces read.
 * Same code set in the 1953 and 1979 presets — one shard, no era variant.
 */
export const GR_GEO_URL = "/gr-regions.json";

export const GR_REGION_CODES = [
  "GR_ATT",
  "GR_EPC",
  "GR_ISL",
  "GR_MAC",
  "GR_PEL",
  "GR_THE",
] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const GR_LABEL_OVERRIDES: Record<string, string> = {
  GR_ATT: "Attica",
  GR_MAC: "Macedonia",
  GR_EPC: "Epirus & C.",
  GR_ISL: "Islands",
  GR_PEL: "Pelop.",
  GR_THE: "Thessaly",
};

export function isGreeceRegion(code: string): boolean {
  return (GR_REGION_CODES as readonly string[]).includes(code);
}
