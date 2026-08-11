/**
 * Sweden's eight macro-regions, keyed by region code (= the game's
 * `states._id`). Ownership is read live from `states.countryId`. The shard
 * `public/se-regions.json` is built by `scripts/maps/build-se-geo.mjs`
 * (21 counties dissolved through one shared topology), features tagged
 * `properties.regionCode` plus the legacy `id`/`na` other surfaces read.
 * Same code set in the 1953 and 1979 presets — one shard, no era variant.
 */
export const SE_GEO_URL = "/se-regions.json";

export const SE_REGION_CODES = [
  "SE_EAS",
  "SE_GOT",
  "SE_NOR",
  "SE_SKA",
  "SE_SML",
  "SE_STH",
  "SE_UPP",
  "SE_VML",
] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const SE_LABEL_OVERRIDES: Record<string, string> = {
  SE_GOT: "W. Sweden",
  SE_EAS: "E. Sweden",
  SE_UPP: "Uppland",
  SE_NOR: "Norrland",
};

export function isSwedenRegion(code: string): boolean {
  return (SE_REGION_CODES as readonly string[]).includes(code);
}
