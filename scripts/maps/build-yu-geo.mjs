// Build public/yu-regions.json — Yugoslavia's eight federal units (six
// republics + Serbia's autonomous provinces Vojvodina and Kosovo), matching
// src/lib/seeds/yu/yuRegions.ts.
//
// Multi-source assembly (all geoBoundaries gbOpen):
//   - SVN/HRV/BIH/MNE/MKD ADM0 → Slovenia/Croatia/Bosnia/Montenegro/Macedonia
//   - XKX ADM0 → Kosovo
//   - SRB ADM1 (25 districts) → Vojvodina (its 7 districts) + Serbia proper (18)
//
// Because pieces come from separately-digitized files, cross-country borders
// don't share arcs — that's acceptable: the nation map strokes internal borders
// (hairlines invisible), and the /world overlay's polygon-clipping union keeps
// only outer rings, explicitly dropping gap/sliver holes from
// independently-digitized borders (see regionOverlay.computeRegionBlobs).
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE
// in (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a
// CCW outer ring as "the globe minus the shape".
// Run: node scripts/maps/build-yu-geo.mjs
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const GB = (iso, adm) => `https://www.geoboundaries.org/api/current/gbOpen/${iso}/${adm}/`;

// ADM0 units: one source country → one region.
const ADM0_UNITS = [
  { iso: "SVN", region: "YU_SLO" },
  { iso: "HRV", region: "YU_CRO" },
  { iso: "BIH", region: "YU_BIH" },
  { iso: "MNE", region: "YU_MNE" },
  { iso: "MKD", region: "YU_MKD" },
  { iso: "XKX", region: "YU_KOS" },
];

// SRB ADM1 districts (geoBoundaries English shapeNames). Vojvodina = its seven
// districts; every other district (incl. Belgrade) is Serbia proper. Kosovo is
// NOT in the SRB file (it ships separately as XKX).
const VOJVODINA_DISTRICTS = new Set([
  "North Backa District",
  "West Backa District",
  "South Backa District",
  "North Banat District",
  "Central Banat District",
  "South Banat District",
  "Syrmia District",
]);

const REGION_NAMES = {
  YU_SLO: "Slovenia",
  YU_CRO: "Croatia",
  YU_BIH: "Bosnia & Herzegovina",
  YU_SRB: "Serbia",
  YU_VOJ: "Vojvodina",
  YU_KOS: "Kosovo",
  YU_MNE: "Montenegro",
  YU_MKD: "Macedonia",
};

// ADM0 outlines are dense: arcs are simplified IN THE TOPOLOGY (Visvalingam,
// endpoints pinned) so the SRB districts' shared borders stay consistent.
// Threshold in deg² of triangle area; output coords round to 4 decimals.
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
// scales. Keeps Krk/Cres/Brač/Hvar/Korčula; sheds the small-archipelago specks.
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

const objects = {};
const push = (regionId, feature) =>
  (objects[regionId] ??= { type: "FeatureCollection", features: [] }).features.push(feature);

for (const { iso, region } of ADM0_UNITS) {
  const gj = await fetchGB(iso, "ADM0");
  if (gj.features.length !== 1)
    throw new Error(`${iso} ADM0: expected 1 feature, got ${gj.features.length}`);
  push(region, gj.features[0]);
  console.log(`${iso} ADM0 → ${region}`);
}

const srb = await fetchGB("SRB", "ADM1");
let voj = 0,
  srbProper = 0;
for (const f of srb.features) {
  const name = f.properties?.shapeName;
  if (!name) throw new Error(`SRB district with no shapeName`);
  if (VOJVODINA_DISTRICTS.has(name)) {
    push("YU_VOJ", f);
    voj++;
  } else {
    push("YU_SRB", f);
    srbProper++;
  }
}
if (voj !== 7) throw new Error(`Vojvodina matched ${voj} districts, expected 7`);
if (srbProper !== 18) throw new Error(`Serbia proper matched ${srbProper} districts, expected 18`);
console.log(`SRB ADM1 → YU_VOJ (${voj}), YU_SRB (${srbProper})`);

// Unquantized topology: arcs keep absolute coordinates, so they can be
// simplified in place (a quantized topology delta-encodes arcs).
const topo = topology(objects);
topo.arcs = topo.arcs.map(simplifyArc);

const out = [];
for (const [regionId, na] of Object.entries(REGION_NAMES)) {
  const obj = topo.objects[regionId];
  if (!obj) throw new Error(`no source features mapped to ${regionId}`);
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
writeFileSync(pub("yu-regions.json"), json + "\n");
console.log(
  `wrote ${out.length} features (${(json.length / 1024).toFixed(0)}KB): ${out
    .map((f) => f.properties.regionCode)
    .join(", ")}`
);
