/**
 * The combined British-Isles region geometry, keyed by region code. One source
 * for the UK map, the IE map, and the world overlay — region identity is the
 * code; which country it renders under is read live from `states.countryId`.
 *
 * The geometry file is built by `scripts/maps/build-british-isles-geo.mjs`
 * (UK NUTS1 + IE regions, each feature tagged `properties.regionCode`).
 */
export const BRITISH_ISLES_GEO_URL = "/british-isles-regions.json";

export const UK_REGION_CODES = [
  "NEE",
  "NWE",
  "YHU",
  "EMI",
  "WMI",
  "EAE",
  "LON",
  "SEE",
  "SWE",
  "WAL",
  "SCO",
  "NIR",
] as const;

export const IE_REGION_CODES = ["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"] as const;

export const BRITISH_ISLES_REGION_CODES: string[] = [...UK_REGION_CODES, ...IE_REGION_CODES];

export function isBritishIslesRegion(code: string): boolean {
  return BRITISH_ISLES_REGION_CODES.includes(code);
}
