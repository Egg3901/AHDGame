/**
 * The German Länder region geometry, keyed by region code. The single source for
 * the world overlay's Germany — region identity is the code; which country it
 * renders under is read live from `states.countryId`. In unified eras all 16
 * codes belong to `DE` (one merged Germany blob); in 1979 the five eastern codes
 * belong to `DD` (a separate East Germany blob). No date logic in the map — the
 * British-Isles model, applied to Germany.
 *
 * The geometry file is built by `scripts/maps/build-germany-geo.mjs` from
 * `de-laender.json` (each feature tagged `properties.regionCode`; Bremen `HB`→
 * `BRE`). West Berlin (`BE`) is its own feature so the nation map can draw it;
 * the world overlay folds `BE` onto Brandenburg's owner at render time (see
 * {@link WORLD_OVERLAY_OWNER_FOLD}), so Berlin still shows East in 1979.
 */
export const GERMANY_GEO_URL = "/germany-regions.json";

// West Germany (FRG, DE in 1979). West Berlin (`BE`) is its own region/shape so the
// /country/de/map nation map can draw it; on the WORLD overlay the BE feature is
// folded to Brandenburg's owner (so Berlin renders East in 1979) — see WorldMapSVG.
export const WEST_DE_REGION_CODES = [
  "BW",
  "BY",
  "NW",
  "HE",
  "RP",
  "SL",
  "NI",
  "SH",
  "HH",
  "BRE",
  "BE",
] as const;

// East Germany (GDR, DD in 1979). Brandenburg (`BB`) carries the Berlin enclave as
// an interior hole; the world overlay's BE→BB fold fills it. East Berlin (`BEO`) is
// a DD gameplay state with no separate world-map shape.
export const EAST_DE_REGION_CODES = ["BB", "MV", "SN", "ST", "TH"] as const;

export const GERMANY_REGION_CODES: string[] = [...WEST_DE_REGION_CODES, ...EAST_DE_REGION_CODES];

/**
 * On the WORLD overlay only, a region feature renders under ANOTHER region's owner.
 * West Berlin's (`BE`) shape is geographically inside Brandenburg, so on the world
 * map it follows Brandenburg's owner — folding it into the GDR blob in 1979 (and
 * filling Brandenburg's Berlin-enclave hole). The nation map ignores this and draws
 * `BE` as West Berlin's own region. Keyed: feature code → the code whose owner it
 * borrows.
 */
export const WORLD_OVERLAY_OWNER_FOLD: Record<string, string> = { BE: "BB" };

export function isGermanyRegion(code: string): boolean {
  return GERMANY_REGION_CODES.includes(code);
}
