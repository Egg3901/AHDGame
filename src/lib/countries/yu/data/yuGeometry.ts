/**
 * Yugoslavia's eight federal units (1974 constitution: six republics plus
 * Serbia's two autonomous provinces), keyed by region code (= the game's
 * `states._id`). Ownership is read live from `states.countryId`. The shard
 * `public/yu-regions.json` is built by `scripts/maps/build-yu-geo.mjs`
 * (modern successor-state outlines + Serbian districts, dissolved through one
 * topology), features tagged `properties.regionCode` plus the legacy `id`/`na`
 * other surfaces read. Same code set in the 1953 and 1979 presets — one shard,
 * no era variant.
 */
export const YU_GEO_URL = "/yu-regions.json";

export const YU_REGION_CODES = [
  "YU_BIH",
  "YU_CRO",
  "YU_KOS",
  "YU_MKD",
  "YU_MNE",
  "YU_SLO",
  "YU_SRB",
  "YU_VOJ",
] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const YU_LABEL_OVERRIDES: Record<string, string> = {
  YU_BIH: "Bosnia",
  YU_MKD: "Macedonia",
  YU_MNE: "Mont.",
};

export function isYugoslaviaRegion(code: string): boolean {
  return (YU_REGION_CODES as readonly string[]).includes(code);
}
