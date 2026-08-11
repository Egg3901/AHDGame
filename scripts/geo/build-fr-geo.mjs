// Build public/fr-regions.json from France's 96 metropolitan departments —
// dissolve them into the game's 8 macro-regions (FR_REGION_CODES, matching
// src/lib/seeds/fr/frRegions.ts). Departments are dissolved through ONE shared
// topojson topology so adjacent macro-regions share border arcs and union
// cleanly into one France blob on the /world overlay (see build-brazil-geo.mjs).
//
// Departments (not régions) are the source unit because they are stable across
// the 2016 régions reform AND both game eras: the seed's macro-regions group the
// pre-1982 régions, whose department membership is fixed. Composition was
// back-solved from the seed's 1979 populations (e.g. both Normandies belong to
// West at 8.6M; Bourgogne + Limousin belong to Center at 4.6M). Overseas
// departments/collectivities are excluded (codes > 95x); Corsica (2A/2B, a
// single department until 1976) maps to Mediterranean either way.
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE
// in (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a
// CCW outer ring as "the globe minus the shape".
//
// Sources (first that works): gregoiredavid/france-geojson departements
// (properties.code/nom), geoBoundaries FRA ADM2 (properties.shapeISO/shapeName).
// Network: fetches the upstream GeoJSON. Deterministic (sorted by regionCode).
// Run: node scripts/maps/build-fr-geo.mjs
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const SOURCES = [
  {
    name: "gregoiredavid/france-geojson departements",
    url: "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements.geojson",
    codeProp: (p) => p?.code,
  },
  {
    name: "geoBoundaries FRA ADM2",
    url: "https://www.geoboundaries.org/api/current/gbOpen/FRA/ADM2/",
    // shapeISO like "FR-2A"/"FR-75"; fall back to nothing so unmapped fails loudly.
    codeProp: (p) => (p?.shapeISO ?? "").replace(/^FR-/, ""),
    indirect: true, // API returns metadata; the GeoJSON itself is at .gjDownloadURL
  },
];

// Department code → game macro-region, via pre-1982 région membership.
const REGIONS = {
  FR_IDF: { na: "Île-de-France", departments: ["75", "77", "78", "91", "92", "93", "94", "95"] },
  FR_NOR: { na: "North", departments: ["59", "62", "02", "60", "80"] }, // Nord-Pas-de-Calais + Picardie
  FR_EST: {
    na: "East",
    departments: [
      "67",
      "68",
      "54",
      "55",
      "57",
      "88",
      "08",
      "10",
      "51",
      "52",
      "25",
      "39",
      "70",
      "90",
    ],
  }, // Alsace + Lorraine + Champagne-Ardenne + Franche-Comté
  FR_OUE: {
    na: "West",
    departments: [
      "22",
      "29",
      "35",
      "56",
      "44",
      "49",
      "53",
      "72",
      "85",
      "14",
      "50",
      "61",
      "27",
      "76",
    ],
  }, // Bretagne + Pays de la Loire + both Normandies
  FR_SOU: {
    na: "Southwest",
    departments: [
      "24",
      "33",
      "40",
      "47",
      "64",
      "09",
      "12",
      "31",
      "32",
      "46",
      "65",
      "81",
      "82",
      "16",
      "17",
      "79",
      "86",
    ],
  }, // Aquitaine + Midi-Pyrénées + Poitou-Charentes
  FR_ARA: {
    na: "Auvergne-Rhône-Alpes",
    departments: ["01", "07", "26", "38", "42", "69", "73", "74", "03", "15", "43", "63"],
  }, // Rhône-Alpes + Auvergne
  FR_MED: {
    na: "Mediterranean",
    departments: ["04", "05", "06", "13", "83", "84", "11", "30", "34", "48", "66", "2A", "2B"],
  }, // PACA + Languedoc-Roussillon + Corse
  FR_CEN: {
    na: "Center",
    departments: ["18", "28", "36", "37", "41", "45", "21", "58", "71", "89", "19", "23", "87"],
  }, // Centre + Bourgogne + Limousin
};

// Pre-1976 sources may carry Corsica as one department "20".
const CODE_ALIASES = { 20: "2A" };

const DEPT_TO_REGION = new Map();
for (const [regionId, { departments }] of Object.entries(REGIONS))
  for (const d of departments) DEPT_TO_REGION.set(d, regionId);
if (DEPT_TO_REGION.size !== 96)
  throw new Error(`department table has ${DEPT_TO_REGION.size} entries, expected 96`);

// Department sources are dense: arcs are simplified IN THE TOPOLOGY
// (Visvalingam, endpoints pinned), so a shared border simplifies identically
// for both neighbors and the macro-regions still union cleanly on the world
// map. Threshold in deg² of triangle area; output coords round to 4 decimals.
const SIMPLIFY_MIN_TRIANGLE = 1.2e-5;
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
// scales. Keeps Corsica/Oléron; sheds Île de Ré-scale specks.
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

const roundGeometry = (geometry) => {
  const roundRing = (r) => r.map(([x, y]) => [ROUND(x), ROUND(y)]);
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const rounded = polys.map((poly) => poly.map(roundRing));
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: rounded[0] }
    : { type: "MultiPolygon", coordinates: rounded };
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

const { gj, codeProp, name: sourceName } = await fetchSource();
console.log(`source: ${sourceName}, ${gj.features.length} features`);

const objects = {};
const seen = new Set();
for (const f of gj.features) {
  const rawCode = String(codeProp(f.properties) ?? "");
  const code = CODE_ALIASES[rawCode] ?? rawCode;
  const regionId = DEPT_TO_REGION.get(code);
  if (!regionId) {
    // Overseas departments/collectivities (971+, 984+…) are expected and skipped.
    if (/^9[7-9]/.test(code) || code === "") {
      continue;
    }
    throw new Error(`unmapped department: "${rawCode}" (${JSON.stringify(f.properties)})`);
  }
  if (seen.has(code)) throw new Error(`duplicate department: "${rawCode}"`);
  seen.add(code);
  (objects[regionId] ??= { type: "FeatureCollection", features: [] }).features.push(f);
}
if (seen.size !== 96) throw new Error(`consumed ${seen.size} departments, expected 96`);

// Unquantized topology: arcs keep absolute coordinates, so they can be
// simplified in place (a quantized topology delta-encodes arcs).
const topo = topology(objects);
topo.arcs = topo.arcs.map(simplifyArc);

const out = [];
for (const [regionId, { na }] of Object.entries(REGIONS)) {
  const obj = topo.objects[regionId];
  if (!obj) throw new Error(`no departments mapped to ${regionId}`);
  // topoMerge dissolves the macro-region's departments, removing internal shared arcs.
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
writeFileSync(pub("fr-regions.json"), json + "\n");
console.log(
  `wrote ${out.length} features (${(json.length / 1024).toFixed(0)}KB): ${out
    .map((f) => f.properties.regionCode)
    .join(", ")}`
);
