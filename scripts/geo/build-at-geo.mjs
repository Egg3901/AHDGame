// Build public/at-regions.json from Austria's 9 Bundesländer (geoBoundaries
// AUT ADM1) — dissolve them into the game's 5 macro-regions (matching
// src/lib/seeds/at/atRegions.ts). Länder are dissolved through ONE shared
// topojson topology so adjacent macro-regions share border arcs and union
// cleanly into one Austria blob on the /world overlay (see build-gr-geo.mjs).
//
// Assignment notes: Burgenland folds into Lower Austria (the eastern/Soviet
// zone); Salzburg into Upper Austria (the Danube/US zone); Carinthia into
// Styria (the south/UK zone); Vorarlberg into Tyrol (the Alpine west/French
// zone). AT_TYR stays a MultiPolygon — East Tyrol is an exclave separated
// from North Tyrol by Salzburg land, so no island-dropping here (landlocked).
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE
// in (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a
// CCW outer ring as "the globe minus the shape".
// Run: node scripts/maps/build-at-geo.mjs
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

// geoBoundaries AUT ADM1 shapeNames (German), grouped into the five regions.
const REGIONS = {
  AT_VIE: { na: "Vienna", units: ["Wien"] },
  AT_NOE: { na: "Lower Austria & Burgenland", units: ["Niederösterreich", "Burgenland"] },
  AT_OOE: { na: "Upper Austria & Salzburg", units: ["Oberösterreich", "Salzburg"] },
  AT_STK: { na: "Styria & Carinthia", units: ["Steiermark", "Kärnten"] },
  AT_TYR: { na: "Tyrol & Vorarlberg", units: ["Tirol", "Vorarlberg"] },
};

const UNIT_TO_REGION = new Map();
for (const [regionId, { units }] of Object.entries(REGIONS))
  for (const u of units) UNIT_TO_REGION.set(fold(u), regionId);
if (UNIT_TO_REGION.size !== 9)
  throw new Error(`Bundesland table has ${UNIT_TO_REGION.size} entries, expected 9`);

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

const aut = await fetchGB("AUT", "ADM1");
if (aut.features.length !== 9)
  throw new Error(`AUT ADM1: expected 9 Bundesländer, got ${aut.features.length}`);

const objects = {};
const seen = new Set();
for (const f of aut.features) {
  const raw = f.properties?.shapeName;
  if (!raw) throw new Error(`AUT Bundesland with no shapeName`);
  const key = fold(raw);
  const regionId = UNIT_TO_REGION.get(key);
  if (!regionId) throw new Error(`unmapped Bundesland: "${raw}" (folded: ${key})`);
  if (seen.has(key)) throw new Error(`duplicate Bundesland: "${raw}"`);
  seen.add(key);
  (objects[regionId] ??= { type: "FeatureCollection", features: [] }).features.push(f);
}
if (seen.size !== 9) throw new Error(`consumed ${seen.size} Bundesländer, expected 9`);

// Unquantized topology: arcs keep absolute coordinates, so they can be
// simplified in place (a quantized topology delta-encodes arcs).
const topo = topology(objects);
topo.arcs = topo.arcs.map(simplifyArc);

const out = [];
for (const [regionId, { na }] of Object.entries(REGIONS)) {
  const obj = topo.objects[regionId];
  if (!obj) throw new Error(`no Bundesländer mapped to ${regionId}`);
  const geometry = rewind(roundGeometry(topoMerge(topo, [obj])));
  out.push({
    type: "Feature",
    id: regionId,
    properties: { id: regionId, na, regionCode: regionId },
    geometry,
  });
}
out.sort((a, b) => a.properties.regionCode.localeCompare(b.properties.regionCode));

const json = JSON.stringify({ type: "FeatureCollection", features: out });
writeFileSync(pub("at-regions.json"), json + "\n");
console.log(
  `wrote ${out.length} features (${(json.length / 1024).toFixed(0)}KB): ${out
    .map((f) => f.properties.regionCode)
    .join(", ")}`
);
