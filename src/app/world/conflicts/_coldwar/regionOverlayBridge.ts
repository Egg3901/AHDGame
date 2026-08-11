// Bridges the live ownership/region system to the (otherwise static) Cold War
// bloc map: maps a game countryId to the baked SVG's country key + bloc, and
// projects lon/lat region blobs into the baked SVG's coordinate space so the map
// GEOMETRY reflects live territory transfers (coloured by the static bloc table).
import { NATIONS, type BlocId } from "./blocs";

// Game countryId → the baked map's country key (countries-110m name = NATIONS key).
// Covers the manifest base countries + the major Cold War powers that can own a
// transferred region. A country absent here colours as "other" (non-aligned).
const COUNTRY_TO_MAP_NAME: Record<string, string> = {
  US: "United States of America",
  UK: "United Kingdom",
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  JP: "Japan",
  CN: "China",
  BR: "Brazil",
  IE: "Ireland",
  RU: "Russia",
  IN: "India",
  EG: "Egypt",
  NG: "Nigeria",
  PL: "Poland",
  HU: "Hungary",
  RO: "Romania",
  BG: "Bulgaria",
  YU: "Yugoslavia",
  TR: "Turkey",
  SE: "Sweden",
};

// Cold War countries with no countries-110m / NATIONS entry (the modern basemap
// has no East Germany or Czechoslovakia) — give them a fixed bloc directly. Every
// other owner resolves through COUNTRY_TO_MAP_NAME + the NATIONS table.
const BLOC_OVERRIDE: Record<string, BlocId> = { DD: "east", CS: "east" };

/** The baked map's `data-name` for a country (to find/hide its path), if any. */
export function mapNameFor(countryId: string): string | undefined {
  return COUNTRY_TO_MAP_NAME[countryId];
}

/** A country's bloc for colouring an overlay blob (static table + overrides). */
export function blocFor(countryId: string): BlocId {
  if (BLOC_OVERRIDE[countryId]) return BLOC_OVERRIDE[countryId];
  const name = COUNTRY_TO_MAP_NAME[countryId];
  return (name ? NATIONS[name]?.bloc : undefined) ?? "other";
}

// Baked MAP_SVG crop: geoEquirectangular, lon −180..180 → x 0..1000,
// lat 84..−58 → y 0..394.4 (see mapSvg.ts header). Pure linear transform.
const MAP_W = 1000;
const MAP_H = 394.4;
const LAT_TOP = 84;
const LAT_SPAN = 142; // 84 − (−58)

export function projectLonLat(lon: number, lat: number): [number, number] {
  return [((lon + 180) / 360) * MAP_W, ((LAT_TOP - lat) / LAT_SPAN) * MAP_H];
}

/** SVG path `d` for a blob (a MultiPolygon of outer rings) given in lon/lat. */
export function blobPathD(multiPoly: number[][][][]): string {
  let d = "";
  for (const poly of multiPoly) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = projectLonLat(ring[i][0], ring[i][1]);
        d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      d += "Z";
    }
  }
  return d;
}
