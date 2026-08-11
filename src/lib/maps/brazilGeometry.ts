/**
 * The Brazil macro-region geometry, keyed by region code. The single source for
 * Brazil on the generic `RegionalGeoMap` — region identity is the code (= the
 * game's `states._id`), and which country it renders under is read live from
 * `states.countryId`. Brazil has no era split; the five macro-regions are stable.
 *
 * The shard is `public/br-regions.json` (hand-authored geometry), tagged
 * `properties.regionCode` by `scripts/maps/tag-region-shard.mjs` while keeping the
 * legacy `id`/`na` that `RegionMapPaths` still reads on other surfaces.
 */
export const BRAZIL_GEO_URL = "/br-regions.json";

export const BR_REGION_CODES = ["NORTE", "NORDESTE", "CENTRO_OESTE", "SUDESTE", "SUL"] as const;

/**
 * Compact on-map labels — the square Brazil map is too small for full region
 * names, so the drawn `<text>` shows these codes (tooltips keep full names).
 */
export const BR_LABEL_OVERRIDES: Record<string, string> = {
  NORTE: "N",
  NORDESTE: "NE",
  CENTRO_OESTE: "CO",
  SUDESTE: "SE",
  SUL: "S",
};

export function isBrazilRegion(code: string): boolean {
  return (BR_REGION_CODES as readonly string[]).includes(code);
}
