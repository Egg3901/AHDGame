// Build public/cs-regions.json — Czechoslovakia's three historic lands
// (Bohemia, Moravia, Slovakia), matching src/lib/seeds/cs/csRegions.ts.
//
// Multi-source assembly (all geoBoundaries gbOpen):
//   - SVK ADM0 → Slovakia
//   - CZE ADM1 (14 kraje) → Moravia (the five Moravian/Silesian kraje incl.
//     Vysočina) + Bohemia (the remaining nine)
//
// Because pieces come from separately-digitized files, the Czech–Slovak border
// doesn't share arcs — acceptable for the same reason as the YU shard: the
// nation map strokes internal borders and the /world overlay's union drops
// gap/sliver holes (see regionOverlay.computeRegionBlobs).
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE
// in (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a
// CCW outer ring as "the globe minus the shape".
// Run: node scripts/maps/build-cs-geo.mjs
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const GB = (iso, adm) => `https://www.geoboundaries.org/api/current/gbOpen/${iso}/${adm}/`;

// CZE ADM1 kraje that are historically Moravian (or Czech Silesia). Vysočina
// straddles the old land border; it goes to Moravia so both halves stay
// contiguous. Everything else in the CZE file is Bohemia.
const MORAVIAN_KRAJE = new Set([
  "Kraj Vysočina",
  "Jihomoravský kraj",
  "Olomoucký kraj",
  "Moravskoslezský kraj",
  "Zlínský kraj",
]);

const REGION_NAMES = {
  CS_PRG: "Prague",
  CS_BOH: "Bohemia",
  CS_MOR: "Moravia",
  CS_SVK: "Slovakia",
};

// Drop degenerate sliver polygons (deg²; ~1 km²) the SVK source carries —
// landlocked country, so anything this small is digitization noise, not an
// island. Applied to whole polygons (outer ring area), never to holes.
const MIN_POLY_AREA = 1e-4;
const polyRingArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++)
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a / 2);
};
const dropTinyPolys = (geometry) => {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const kept = polys.filter((poly) => polyRingArea(poly[0]) >= MIN_POLY_AREA);
  return kept.length === 1
    ? { type: "Polygon", coordinates: kept[0] }
    : { type: "MultiPolygon", coordinates: kept };
};

// Same simplification/rounding pipeline as build-yu-geo.mjs: arcs simplified
// IN THE TOPOLOGY (Visvalingam, endpoints pinned) so shared kraj borders stay
// consistent; threshold in deg² of triangle area; coords round to 4 decimals.
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

const objects = {};
const push = (regionId, feature) =>
  (objects[regionId] ??= { type: "FeatureCollection", features: [] }).features.push(feature);

const svk = await fetchGB("SVK", "ADM0");
if (svk.features.length !== 1)
  throw new Error(`SVK ADM0: expected 1 feature, got ${svk.features.length}`);
push("CS_SVK", svk.features[0]);
console.log("SVK ADM0 → CS_SVK");

const cze = await fetchGB("CZE", "ADM1");
let mor = 0,
  boh = 0,
  prg = 0;
for (const f of cze.features) {
  const name = f.properties?.shapeName;
  if (!name) throw new Error(`CZE kraj with no shapeName`);
  if (/praha|prague/i.test(name)) {
    push("CS_PRG", f);
    prg++;
  } else if (MORAVIAN_KRAJE.has(name)) {
    push("CS_MOR", f);
    mor++;
  } else {
    push("CS_BOH", f);
    boh++;
  }
}
if (prg !== 1) throw new Error(`Prague matched ${prg} kraje, expected 1`);
if (mor !== 5) throw new Error(`Moravia matched ${mor} kraje, expected 5`);
if (boh !== 8) throw new Error(`Bohemia matched ${boh} kraje, expected 8`);
console.log(`CZE ADM1 → CS_PRG (${prg}), CS_MOR (${mor}), CS_BOH (${boh})`);

// Unquantized topology: arcs keep absolute coordinates, so they can be
// simplified in place (a quantized topology delta-encodes arcs).
const topo = topology(objects);
topo.arcs = topo.arcs.map(simplifyArc);

const out = [];
for (const [regionId, na] of Object.entries(REGION_NAMES)) {
  const obj = topo.objects[regionId];
  if (!obj) throw new Error(`no source features mapped to ${regionId}`);
  const geometry = rewind(roundGeometry(dropTinyPolys(topoMerge(topo, [obj]))));
  out.push({
    type: "Feature",
    id: regionId,
    properties: { id: regionId, na, regionCode: regionId },
    geometry,
  });
}
out.sort((a, b) => a.properties.regionCode.localeCompare(b.properties.regionCode));

const json = JSON.stringify({ type: "FeatureCollection", features: out });
writeFileSync(pub("cs-regions.json"), json + "\n");
console.log(
  `wrote ${out.length} features (${(json.length / 1024).toFixed(0)}KB): ${out
    .map((f) => f.properties.regionCode)
    .join(", ")}`
);
