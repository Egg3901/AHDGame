/**
 * Poland's eight macro-regions, keyed by region code (= the game's
 * `states._id`). Ownership is read live from `states.countryId`. The shard
 * `public/pl-regions.json` is built by `scripts/maps/build-pl-geo.mjs`
 * (16 voivodeships dissolved through one shared topology), features tagged
 * `properties.regionCode` plus the legacy `id`/`na` other surfaces read.
 * Same code set in the 1953 and 1979 presets — one shard, no era variant
 * (Poland's postwar borders predate both).
 */
export const PL_GEO_URL = "/pl-regions.json";

export const PL_REGION_CODES = [
  "PL_DSL",
  "PL_EAS",
  "PL_LOD",
  "PL_MAL",
  "PL_MAZ",
  "PL_POM",
  "PL_SLK",
  "PL_WLK",
] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const PL_LABEL_OVERRIDES: Record<string, string> = {
  PL_DSL: "L. Silesia",
  PL_EAS: "East",
  PL_LOD: "Łódź",
  PL_MAL: "Lesser Pol.",
  PL_MAZ: "Mazovia",
  PL_POM: "Pomerania",
  PL_SLK: "Silesia",
  PL_WLK: "Greater Pol.",
};

export function isPolandRegion(code: string): boolean {
  return (PL_REGION_CODES as readonly string[]).includes(code);
}
