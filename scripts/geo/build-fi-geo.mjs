// Build public/fi-regions.json from Finland's 19 maakunta (geoBoundaries FIN
// ADM1, English shapeNames) — dissolve them into the game's 6 macro-regions
// (matching src/lib/seeds/fi/fiRegions.ts). Regions are dissolved through ONE
// shared topojson topology so adjacent macro-regions share border arcs and
// union cleanly into one Finland blob on the /world overlay.
//
// Assignment notes: Åland folds into Southwest Finland; Päijät-Häme, Pirkanmaa
// and Central Finland into the Häme block; Kymenlaakso and both Karelias plus
// the Savonias into Eastern Finland; the four Ostrobothnias + Kainuu into
// Ostrobothnia. Coastal archipelago speckle is dropped below MIN_ISLAND_AREA
// (keeps mainland Åland).
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE
// in (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a
// CCW outer ring as "the globe minus the shape".
// Run: node scripts/maps/build-fi-geo.mjs
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const GB = (iso, adm) => `https://www.geoboundaries.org/api/current/gbOpen/${iso}/${adm}/`;

// Ascii-fold lowercase so source spelling variants key the same.
const fold = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");

// geoBoundaries FIN ADM1 shapeNames (English), grouped into the six regions.
const REGIONS = {
  FI_UUS: { na: "Uusimaa", units: ["Uusimaa"] },
  FI_SW: { na: "Southwest Finland", units: ["Finland Proper", "Satakunta", "Åland Islands"] },
  FI_HAM: {
    na: "Häme & Central Finland",
    units: ["Tavastia Proper", "Päijät-Häme", "Pirkanmaa", "Central Finland"],
  },
  FI_EAS: {
    na: "Eastern Finland",
    units: [
      "Kymenlaakso",
      "South Karelia",
      "Southern Savonia",
      "Northern Savonia",
      "North Karelia",
    ],
  },
  FI_OST: {
    na: "Ostrobothnia",
    units: [
      "Ostrobothnia",
      "South Ostrobothnia",
      "Keski-Pohjanmaa",
      "Northern Ostrobothnia",
      "Kainuu",
    ],
  },
  FI_LAP: { na: "Lapland", units: ["Lapland"] },
};

const UNIT_TO_REGION = new Map();
for (const [regionId, { units }] of Object.entries(REGIONS))
  for (const u of units) UNIT_TO_REGION.set(fold(u), regionId);
if (UNIT_TO_REGION.size !== 19)
  throw new Error(`maakunta table has ${UNIT_TO_REGION.size} entries, expected 19`);

// Arcs are simplified IN THE TOPOLOGY (Visvalingam, endpoints pinned) so
// shared borders stay consistent; threshold in deg² of triangle area; output
// coords round to 4 decimals.
const SIMPLIFY_MIN_TRIANGLE = 1.2e-5;
const ROUND = (v) => Math.round(v * 1e4) / 1e4;

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
// scales. Keeps mainland Åland; sheds the archipelago speckle.
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

async function fetchGB(iso, adm) {
  const meta = await (await fetch(GB(iso, adm))).json();
  if (!meta?.gjDownloadURL) throw new Error(`${iso}/${adm}: no gjDownloadURL`);
  const gj = await (await fetch(meta.gjDownloadURL)).json();
  if (!gj?.features?.length) throw new Error(`${iso}/${adm}: no features`);
  return gj;
}

const fin = await fetchGB("FIN", "ADM1");
if (fin.features.length !== 19)
  throw new Error(`FIN ADM1: expected 19 maakunta, got ${fin.features.length}`);

const objects = {};
const seen = new Set();
for (const f of fin.features) {
  const raw = f.properties?.shapeName;
  if (!raw) throw new Error(`FIN maakunta with no shapeName`);
  const key = fold(raw);
  const regionId = UNIT_TO_REGION.get(key);
  if (!regionId) throw new Error(`unmapped maakunta: "${raw}" (folded: ${key})`);
  if (seen.has(key)) throw new Error(`duplicate maakunta: "${raw}"`);
  seen.add(key);
  (objects[regionId] ??= { type: "FeatureCollection", features: [] }).features.push(f);
}
if (seen.size !== 19) throw new Error(`consumed ${seen.size} maakunta, expected 19`);

// Unquantized topology: arcs keep absolute coordinates, so they can be
// simplified in place (a quantized topology delta-encodes arcs).
const topo = topology(objects);
topo.arcs = topo.arcs.map(simplifyArc);

const out = [];
for (const [regionId, { na }] of Object.entries(REGIONS)) {
  const obj = topo.objects[regionId];
  if (!obj) throw new Error(`no maakunta mapped to ${regionId}`);
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
writeFileSync(pub("fi-regions.json"), json + "\n");
console.log(
  `wrote ${out.length} features (${(json.length / 1024).toFixed(0)}KB): ${out
    .map((f) => f.properties.regionCode)
    .join(", ")}`
);
