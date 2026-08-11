/**
 * A rough interior lon/lat point per country, used to ORIENT a front: an invasion
 * shades the host's regions nearest the invader first. Approximate on purpose —
 * this decides a sort order and nothing else. A country absent here falls back to a
 * periphery-inward advance (see orderFeatures in frontGeometry.ts).
 *
 * Same spirit as the COUNTRY_TO_MAP_NAME bridge table in
 * src/app/world/conflicts/_coldwar/regionOverlayBridge.ts.
 */
export const COUNTRY_ANCHOR: Record<string, [number, number]> = {
  US: [-98.5, 39.8],
  UK: [-2.0, 54.0],
  IE: [-8.2, 53.4],
  SCO: [-4.2, 56.8],
  WAL: [-3.8, 52.3],
  RU: [37.6, 55.8],
  DD: [13.4, 52.5],
  DE: [10.4, 51.2],
  FR: [2.3, 46.6],
  IT: [12.5, 42.8],
  ES: [-3.7, 40.4],
  SE: [18.6, 60.1],
  FI: [25.7, 61.9],
  AT: [14.6, 47.6],
  GR: [21.8, 39.1],
  PL: [19.1, 52.1],
  CS: [15.5, 49.8],
  HU: [19.5, 47.2],
  RO: [24.9, 45.9],
  BG: [25.5, 42.7],
  YU: [20.5, 44.0],
  TR: [35.2, 39.0],
  UKR: [31.0, 49.0],
  BLR: [27.9, 53.5],
  BAL: [24.5, 57.0],
  CN: [104.2, 35.9],
  JP: [138.3, 36.2],
  BR: [-51.9, -14.2],
  NG: [8.7, 9.1],
};

/** The orienting point for a country, or null when there is none. */
export function anchorOf(countryId: string): [number, number] | null {
  return COUNTRY_ANCHOR[countryId] ?? null;
}
