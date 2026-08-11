import { STATE_IDS } from "@/lib/constants/states";

/**
 * The US state geometry, keyed by region code (= the game's `states._id`, the
 * 2-letter state abbreviation). Ownership is read live from `states.countryId`.
 * Rendered with `geoAlbersUsa` (which insets Alaska/Hawaii), so the US map joins
 * the generic `RegionalGeoMap` like every other country.
 *
 * The shard `public/usa-regions.json` is BUILT by `scripts/maps/build-usa-geo.mjs`
 * from the us-atlas `us-states-10m.json` TopoJSON (FIPS → state code via the same
 * FIPS_TO_STATE map USAMapPaths uses), tagging each feature `properties.regionCode`.
 */
export const USA_GEO_URL = "/usa-regions.json";

/** All 50 states + DC. The live owned set (which can be fewer in earlier eras) is
 *  what actually renders; this is the full roster / load-time fallback. */
export const US_REGION_CODES: string[] = [...STATE_IDS, "DC"];

export function isUSRegion(code: string): boolean {
  return US_REGION_CODES.includes(code);
}

/**
 * On-map labels for the US always show the state CODE (mode values go in the
 * tooltip) — the long-standing US-map convention. RegionalGeoMap shows
 * `regionData.label` by default, so the US passes this identity override (code →
 * code) to keep "CA", "TX", … on the map regardless of mode.
 */
export const US_LABEL_OVERRIDES: Record<string, string> = Object.fromEntries(
  US_REGION_CODES.map((c) => [c, c])
);
