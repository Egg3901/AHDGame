/**
 * Turkey's eight macro-regions, keyed by region code (= the game's
 * `states._id`). Ownership is read live from `states.countryId`. The shard
 * `public/tr-regions.json` is built by `scripts/maps/build-tr-geo.mjs`
 * (81 ADM1 provinces dissolved through one shared topology), features tagged
 * `properties.regionCode` plus the legacy `id`/`na` other surfaces read.
 * Same code set in the 1953 and 1979 presets — one shard, no era variant.
 */
export const TR_GEO_URL = "/tr-regions.json";

export const TR_REGION_CODES = [
  "TR_ANK",
  "TR_BLA",
  "TR_CEN",
  "TR_ESA",
  "TR_IST",
  "TR_IZM",
  "TR_MED",
  "TR_SEA",
] as const;

/** Compact on-map labels — the Anatolia names overflow the small map tiles. */
export const TR_LABEL_OVERRIDES: Record<string, string> = {
  TR_ESA: "E. Anatolia",
  TR_SEA: "SE Anatolia",
  TR_CEN: "C. Anatolia",
  TR_MED: "Med.",
};

export function isTurkeyRegion(code: string): boolean {
  return (TR_REGION_CODES as readonly string[]).includes(code);
}
