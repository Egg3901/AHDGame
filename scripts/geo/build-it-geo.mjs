// Build public/it-regions.json from Italy's 20 ADM1 regions — dissolve them
// into the game's 8 macro-regions (IT_REGION_CODES; the ISTAT macro-areas with
// Lazio and Campania carved out of Center and South, matching
// src/lib/seeds/it/itRegions.ts). Regions are dissolved through ONE shared
// topojson topology so adjacent macro-regions share border arcs and union
// cleanly into one Italy blob on the /world overlay (see build-brazil-geo.mjs).
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE
// in (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a
// CCW outer ring as "the globe minus the shape".
//
// Era note: the game set is identical in 1953 and 1979. Molise split from
// Abruzzo only in 1963, but both dissolve into IT_SUD, so modern ADM1
// boundaries produce era-correct macro-region outlines.
//
// Sources (first that works): Click-that-Hood italy.geojson (properties.name),
// geoBoundaries ITA ADM1 (properties.shapeName).
// Network: fetches the upstream GeoJSON. Deterministic (sorted by regionCode).
// Run: node scripts/maps/build-it-geo.mjs
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

// NOTE: geoBoundaries ITA ADM1 is the 5 NUTS1 macro-areas (too coarse to carve
// Lazio/Campania out), and Click-that-Hood has no italy dataset — hence the
// openpolis regions file as primary and geoBoundaries ADM2 (the 20 regions'
// constituent units also dissolve correctly) as fallback.
const SOURCES = [
  {
    name: "openpolis geojson-italy (20 regions)",
    url: "https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_IT_regions.geojson",
    nameProp: (p) => p?.reg_name ?? p?.name,
  },
  {
    name: "geoBoundaries ITA ADM2",
    url: "https://www.geoboundaries.org/api/current/gbOpen/ITA/ADM2/",
    nameProp: (p) => p?.shapeName,
    indirect: true, // API returns metadata; the GeoJSON itself is at .gjDownloadURL
  },
];

// Ascii-fold lowercase so source spelling variants key the same.
const fold = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");

// English/bilingual/legacy names some datasets use.
const ALIASES = {
  piedmont: "piemonte",
  aostavalley: "valledaosta",
  valledaostavalleedaoste: "valledaosta",
  valleedaoste: "valledaosta",
  lombardy: "lombardia",
  trentinoaltoadigesudtirol: "trentinoaltoadige",
  trentinosouthtyrol: "trentinoaltoadige",
  tuscany: "toscana",
  themarches: "marche",
  marches: "marche",
  latium: "lazio",
  abruzzi: "abruzzo",
  apulia: "puglia",
  sicily: "sicilia",
  sardinia: "sardegna",
};

const REGIONS = {
  IT_NW: { na: "Northwest", provinces: ["Piemonte", "Valle d'Aosta", "Liguria", "Lombardia"] },
  IT_NE: {
    na: "Northeast",
    provinces: ["Trentino-Alto Adige", "Veneto", "Friuli-Venezia Giulia", "Emilia-Romagna"],
  },
  IT_TUS: { na: "Central Italy", provinces: ["Toscana", "Umbria", "Marche"] },
  IT_LAZ: { na: "Lazio", provinces: ["Lazio"] },
  IT_CAM: { na: "Campania", provinces: ["Campania"] },
  IT_SUD: {
    na: "Southern Italy",
    provinces: ["Abruzzo", "Molise", "Puglia", "Basilicata", "Calabria"],
  },
  IT_SIC: { na: "Sicily", provinces: ["Sicilia"] },
  IT_SAR: { na: "Sardinia", provinces: ["Sardegna"] },
};

const PROVINCE_TO_REGION = new Map();
for (const [regionId, { provinces }] of Object.entries(REGIONS))
  for (const p of provinces) PROVINCE_TO_REGION.set(fold(p), regionId);
if (PROVINCE_TO_REGION.size !== 20)
  throw new Error(`region table has ${PROVINCE_TO_REGION.size} entries, expected 20`);

// The openpolis source is very dense (province-grade coastlines): raw dissolve
// is ~1.2 MB. Arcs are simplified IN THE TOPOLOGY (Visvalingam, endpoints
// pinned), so a shared border simplifies identically for both neighbors and
// the macro-regions still union cleanly into one Italy on the world map.
// Threshold is in deg² of triangle area; output coords round to 4 decimals.
const SIMPLIFY_MIN_TRIANGLE = 4e-6;
const ROUND = (v) => Math.round(v * 1e4) / 1e4;

// Visvalingam–Whyatt on one absolute-coordinate arc; first/last points pinned
// so arc junctions (region tripoints) never move.
const simplifyArc = (arc) => {
  if (arc.length <= 2) return arc;
  const pts = arc.slice();
  const triArea = (a, b, c) =>
    Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    let minArea = Infinity;
    let minI = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = triArea(pts[i - 1], pts[i], pts[i + 1]);
      if (a < minArea) {
        minArea = a;
        minI = i;
      }
    }
    if (minArea < SIMPLIFY_MIN_TRIANGLE) {
      pts.splice(minI, 1);
      changed = true;
    }
  }
  return pts;
};
// Drop islands smaller than this (deg²; ~60 km²) — sub-pixel at both render
// scales. Keeps Sicily/Sardinia/Elba; sheds Capri/Ischia/Aeolian specks.
const MIN_ISLAND_AREA = 5e-3;

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++)
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
};
const dropTinyIslands = (geometry) => {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const kept = polys.filter((poly) => Math.abs(ringArea(poly[0])) >= MIN_ISLAND_AREA);
  return kept.length === 1
    ? { type: "Polygon", coordinates: kept[0] }
    : { type: "MultiPolygon", coordinates: kept };
};

// > 0 => clockwise in (lon,lat).
const windSignedArea = (r) => {
  let s = 0;
  for (let i = 0; i < r.length - 1; i++) s += (r[i + 1][0] - r[i][0]) * (r[i + 1][1] + r[i][1]);
  return s;
};
const rewind = (geometry) => {
  const fixRing = (ring, wantCW) => {
    const a = windSignedArea(ring);
    if (a === 0) return ring;
    return a > 0 === wantCW ? ring : ring.slice().reverse();
  };
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const fixed = polys.map((poly) => poly.map((ring, i) => fixRing(ring, i === 0)));
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: fixed[0] }
    : { type: "MultiPolygon", coordinates: fixed };
};

async function fetchSource() {
  for (const s of SOURCES) {
    try {
      let url = s.url;
      if (s.indirect) {
        const meta = await (await fetch(url)).json();
        url = meta?.gjDownloadURL;
        if (!url) throw new Error("no gjDownloadURL");
      }
      const gj = await (await fetch(url)).json();
      if (gj?.features?.length) return { ...s, gj };
      throw new Error("no features");
    } catch (e) {
      console.warn(`source ${s.name} failed: ${e.message}`);
    }
  }
  throw new Error("all sources failed");
}

const { gj, nameProp, name: sourceName } = await fetchSource();
console.log(`source: ${sourceName}, ${gj.features.length} features`);

const objects = {};
const seen = new Set();
for (const f of gj.features) {
  const raw = nameProp(f.properties);
  if (!raw) throw new Error(`feature with no name: ${JSON.stringify(f.properties)}`);
  const folded = fold(raw);
  const key = ALIASES[folded] ? fold(ALIASES[folded]) : folded;
  const regionId = PROVINCE_TO_REGION.get(key);
  if (!regionId) throw new Error(`unmapped region: "${raw}" (folded: ${key})`);
  if (seen.has(key)) throw new Error(`duplicate region: "${raw}"`);
  seen.add(key);
  (objects[regionId] ??= { type: "FeatureCollection", features: [] }).features.push(f);
}
if (seen.size !== 20) throw new Error(`consumed ${seen.size} regions, expected 20`);

// Unquantized topology: arcs keep absolute coordinates, so they can be
// simplified in place (a quantized topology delta-encodes arcs).
const topo = topology(objects);
topo.arcs = topo.arcs.map(simplifyArc);

const roundGeometry = (geometry) => {
  const roundRing = (r) => r.map(([x, y]) => [ROUND(x), ROUND(y)]);
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const rounded = polys.map((poly) => poly.map(roundRing));
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: rounded[0] }
    : { type: "MultiPolygon", coordinates: rounded };
};

const out = [];
for (const [regionId, { na }] of Object.entries(REGIONS)) {
  const obj = topo.objects[regionId];
  if (!obj) throw new Error(`no regions mapped to ${regionId}`);
  // topoMerge dissolves the macro-region's members, removing internal shared arcs.
  const geometry = rewind(roundGeometry(dropTinyIslands(topoMerge(topo, [obj]))));
  out.push({
    type: "Feature",
    id: regionId,
    properties: { id: regionId, na, regionCode: regionId },
    geometry,
  });
}
out.sort((a, b) => a.properties.regionCode.localeCompare(b.properties.regionCode));

const json = JSON.stringify({ type: "FeatureCollection", features: out });
writeFileSync(pub("it-regions.json"), json + "\n");
console.log(
  `wrote ${out.length} features (${(json.length / 1024).toFixed(0)}KB): ${out
    .map((f) => f.properties.regionCode)
    .join(", ")}`
);
