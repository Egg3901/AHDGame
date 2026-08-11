// Build public/es-regions.json from Spain's autonomous communities — dissolve
// them into the game's 8 macro-regions (ES_REGION_CODES, matching
// src/lib/seeds/es/esRegions.ts). Communities are dissolved through ONE shared
// topojson topology so adjacent macro-regions share border arcs and union
// cleanly into one Spain blob on the /world overlay (see build-brazil-geo.mjs).
//
// The Canary Islands (part of ES_CEN "Central Spain & Islands" in seed data)
// are EXCLUDED from geometry: at 18°W they would double the map fit's extent
// and shrink the mainland to half the tile. Ceuta/Melilla are excluded as
// sub-pixel African exclaves. The Balearics are included.
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE
// in (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a
// CCW outer ring as "the globe minus the shape".
//
// Sources (first that works): geoBoundaries ESP ADM1 (properties.shapeName),
// Click-that-Hood spain-communities (properties.name).
// Network: fetches the upstream GeoJSON. Deterministic (sorted by regionCode).
// Run: node scripts/maps/build-es-geo.mjs
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const SOURCES = [
  {
    name: "geoBoundaries ESP ADM1",
    url: "https://www.geoboundaries.org/api/current/gbOpen/ESP/ADM1/",
    nameProp: (p) => p?.shapeName,
    indirect: true, // API returns metadata; the GeoJSON itself is at .gjDownloadURL
  },
  {
    name: "click-that-hood spain-communities",
    url: "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/spain-communities.geojson",
    nameProp: (p) => p?.name,
  },
];

// Ascii-fold lowercase so source spelling variants key the same.
const fold = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");

// Spanish/Catalan/English/official-long-form names datasets use.
const ALIASES = {
  andalusia: "andalucia",
  catalonia: "cataluna",
  catalunya: "cataluna",
  valencia: "comunidadvalenciana",
  valenciancommunity: "comunidadvalenciana",
  comunitatvalenciana: "comunidadvalenciana",
  murcia: "regiondemurcia",
  basquecountry: "paisvasco",
  euskadi: "paisvasco",
  paisvascoeuskadi: "paisvasco",
  navarre: "comunidadforaldenavarra",
  navarra: "comunidadforaldenavarra",
  asturias: "principadodeasturias",
  madrid: "comunidaddemadrid",
  larioja: "rioja",
  aragon: "aragon",
  balearicislands: "islasbaleares",
  illesbalears: "islasbaleares",
  castileandleon: "castillayleon",
  castilelamancha: "castillalamancha",
  castillala: "castillalamancha",
};

// Excluded outright (see header).
const SKIP = new Set([
  "canarias",
  "canaryislands",
  "islascanarias",
  "ceuta",
  "melilla",
  "ciudadautonomadeceuta",
  "ciudadautonomademelilla",
]);

const REGIONS = {
  ES_MAD: { na: "Madrid", units: ["Comunidad de Madrid"] },
  ES_CAT: { na: "Catalonia", units: ["Cataluña"] },
  ES_AND: { na: "Andalusia", units: ["Andalucía"] },
  ES_VAL: { na: "Valencia & Murcia", units: ["Comunidad Valenciana", "Región de Murcia"] },
  ES_PVB: { na: "Basque Country & Navarre", units: ["País Vasco", "Comunidad Foral de Navarra"] },
  ES_GAL: { na: "Galicia", units: ["Galicia"] },
  ES_NOR: {
    na: "Northern Spain",
    units: ["Principado de Asturias", "Cantabria", "Rioja", "Aragón"],
  },
  ES_CEN: {
    na: "Central Spain & Islands",
    units: ["Castilla y León", "Castilla-La Mancha", "Extremadura", "Islas Baleares"],
  },
};

const UNIT_TO_REGION = new Map();
for (const [regionId, { units }] of Object.entries(REGIONS))
  for (const u of units) UNIT_TO_REGION.set(fold(u), regionId);
if (UNIT_TO_REGION.size !== 16)
  throw new Error(`unit table has ${UNIT_TO_REGION.size} entries, expected 16`);

// Community sources are dense: arcs are simplified IN THE TOPOLOGY
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
// scales. Keeps Mallorca/Menorca/Ibiza; sheds Formentera-scale specks.
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

const { gj, nameProp, name: sourceName } = await fetchSource();
console.log(`source: ${sourceName}, ${gj.features.length} features`);

const objects = {};
const seen = new Set();
for (const f of gj.features) {
  const raw = nameProp(f.properties);
  if (!raw) throw new Error(`feature with no name: ${JSON.stringify(f.properties)}`);
  // Bilingual official names come slash-joined ("Cataluña/Catalunya",
  // "País Vasco/Euskadi") — try the whole name, then each segment.
  const candidates = [raw, ...raw.split("/")].map((c) => {
    const folded = fold(c);
    return ALIASES[folded] ?? folded;
  });
  const key = candidates.find((c) => UNIT_TO_REGION.has(c) || SKIP.has(c));
  if (key === undefined)
    throw new Error(`unmapped community: "${raw}" (tried: ${candidates.join(", ")})`);
  if (SKIP.has(key)) continue;
  const regionId = UNIT_TO_REGION.get(key);
  if (seen.has(key)) throw new Error(`duplicate community: "${raw}"`);
  seen.add(key);
  (objects[regionId] ??= { type: "FeatureCollection", features: [] }).features.push(f);
}
if (seen.size !== 16) throw new Error(`consumed ${seen.size} communities, expected 16`);

// Unquantized topology: arcs keep absolute coordinates, so they can be
// simplified in place (a quantized topology delta-encodes arcs).
const topo = topology(objects);
topo.arcs = topo.arcs.map(simplifyArc);

const out = [];
for (const [regionId, { na }] of Object.entries(REGIONS)) {
  const obj = topo.objects[regionId];
  if (!obj) throw new Error(`no communities mapped to ${regionId}`);
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
writeFileSync(pub("es-regions.json"), json + "\n");
console.log(
  `wrote ${out.length} features (${(json.length / 1024).toFixed(0)}KB): ${out
    .map((f) => f.properties.regionCode)
    .join(", ")}`
);
