// Build public/blr-regions.json — the Byelorussian SSR's six oblasts, matching
// src/lib/seeds/blr/blrRegions1953.ts.
//
// Single source: geoBoundaries gbOpen BLR ADM1 (six oblasts plus Minsk City,
// which is folded into Minsk oblast — the city is an enclave inside it, and a
// separate one-city region would carry a third of the republic's politics on a
// dot). Shared oblast borders come from one file, so the dissolve produces
// clean internal boundaries.
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE
// in (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a
// CCW outer ring as "the globe minus the shape".
// Run: node scripts/maps/build-blr-geo.mjs
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const GB = (iso, adm) => `https://www.geoboundaries.org/api/current/gbOpen/${iso}/${adm}/`;

const REGION_PROVINCES = {
  BLR_MIN: ["Minsk", "Minsk City"],
  BLR_BRE: ["Brest"],
  BLR_HOM: ["Gomel"],
  BLR_GRO: ["Grodno"],
  BLR_MOG: ["Mogilev"],
  BLR_VIT: ["Vitebsk"],
};

const REGION_NAMES = {
  BLR_MIN: "Minsk",
  BLR_BRE: "Brest",
  BLR_HOM: "Gomel",
  BLR_GRO: "Grodno",
  BLR_MOG: "Mogilev",
  BLR_VIT: "Vitebsk",
};

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

const provinceToRegion = new Map();
for (const [regionId, names] of Object.entries(REGION_PROVINCES))
  for (const n of names) provinceToRegion.set(n, regionId);

const objects = {};
const push = (regionId, feature) =>
  (objects[regionId] ??= { type: "FeatureCollection", features: [] }).features.push(feature);

const blr = await fetchGB("BLR", "ADM1");
if (blr.features.length !== 7)
  throw new Error(`BLR ADM1: expected 7 units, got ${blr.features.length}`);
const counts = {};
for (const f of blr.features) {
  const name = f.properties?.shapeName;
  const regionId = provinceToRegion.get(name);
  if (!regionId) throw new Error(`unmapped BLR unit: ${JSON.stringify(name)}`);
  push(regionId, f);
  counts[regionId] = (counts[regionId] ?? 0) + 1;
}
for (const [regionId, names] of Object.entries(REGION_PROVINCES))
  if (counts[regionId] !== names.length)
    throw new Error(`${regionId} matched ${counts[regionId]} units, expected ${names.length}`);
console.log(
  `BLR ADM1 → ${Object.entries(counts)
    .map(([r, c]) => `${r} (${c})`)
    .join(", ")}`
);

const topo = topology(objects);
topo.arcs = topo.arcs.map(simplifyArc);

const out = [];
for (const [regionId, na] of Object.entries(REGION_NAMES)) {
  const obj = topo.objects[regionId];
  if (!obj) throw new Error(`no source features mapped to ${regionId}`);
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
writeFileSync(pub("blr-regions.json"), json + "\n");
console.log(
  `wrote ${out.length} features (${(json.length / 1024).toFixed(0)}KB): ${out
    .map((f) => f.properties.regionCode)
    .join(", ")}`
);
