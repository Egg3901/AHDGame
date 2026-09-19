/**
 * Austria's five macro-regions, keyed by region code (= the game's
 * `states._id`). Ownership is read live from `states.countryId`. The shard
 * `public/at-regions.json` is built by `scripts/maps/build-at-geo.mjs`
 * (9 Bundesländer dissolved through one shared topology), features tagged
 * `properties.regionCode` plus the legacy `id`/`na` other surfaces read.
 * Same code set in the 1953 and 1979 presets — one shard, no era variant.
 */
export const AT_GEO_URL = "/at-regions.json";

export const AT_REGION_CODES = ["AT_NOE", "AT_OOE", "AT_STK", "AT_TYR", "AT_VIE"] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const AT_LABEL_OVERRIDES: Record<string, string> = {
  AT_VIE: "Vienna",
  AT_NOE: "Lower A.",
  AT_OOE: "Upper A.",
  AT_STK: "Styria",
  AT_TYR: "Tyrol",
};

export function isAustriaRegion(code: string): boolean {
  return (AT_REGION_CODES as readonly string[]).includes(code);
}
