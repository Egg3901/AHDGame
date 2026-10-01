// Build the historic BG shard and the 2027 six-region NUTS II shard from the
// same 28 province boundaries. The latter matches bgRegions2027.ts.
//
// Single source: geoBoundaries gbOpen BGR ADM1 (28 provinces), partitioned
// along the Balkan range — the west (Sofia basin + Pirin/Rila highlands), the
// north (Danubian Plain + the coast down through Varna), and the south
// (Thracian Plain + Rhodopes + Burgas coast). Shared province borders come
// from one file, so the dissolve produces clean internal boundaries.
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE
// in (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a
// CCW outer ring as "the globe minus the shape".
// Run: node scripts/geo/build-bg-geo.mjs
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const GB = (iso, adm) => `https://www.geoboundaries.org/api/current/gbOpen/${iso}/${adm}/`;

// geoBoundaries BGR ADM1 English shapeNames, grouped into the five regions.
const REGION_PROVINCES = {
  BG_SOF: ["Sofia City", "Sofia"],
  BG_NOR: [
    "Vidin",
    "Montana",
    "Vratsa",
    "Pleven",
    "Lovech",
    "Gabrovo",
    "Veliko Tarnovo",
    "Ruse",
    "Razgrad",
    "Silistra",
    "Targovishte",
    "Shumen",
  ],
  BG_COA: ["Varna", "Dobrich", "Burgas"],
  BG_THR: [
    "Pazardzhik",
    "Plovdiv",
    "Smolyan",
    "Kardzhali",
    "Haskovo",
    "Stara Zagora",
    "Sliven",
    "Yambol",
  ],
  BG_SW: ["Pernik", "Kyustendil", "Blagoevgrad"],
};

const REGION_NAMES = {
  BG_SOF: "Sofia",
  BG_NOR: "Northern Bulgaria",
  BG_COA: "Black Sea Coast",
  BG_THR: "Thrace",
  BG_SW: "Southwestern Bulgaria",
};

// NUTS 2021 level 2 province membership (Eurostat BGR NUTS correspondence).
// Keep this partition separate from the five historic game regions above.
const NUTS2_PROVINCES = {
  BG31: ["Vidin", "Montana", "Vratsa", "Pleven", "Lovech"],
  BG32: ["Gabrovo", "Veliko Tarnovo", "Ruse", "Razgrad", "Silistra"],
  BG33: ["Varna", "Dobrich", "Targovishte", "Shumen"],
  BG34: ["Burgas", "Sliven", "Yambol", "Stara Zagora"],
  BG41: ["Sofia City", "Sofia", "Pernik", "Kyustendil", "Blagoevgrad"],
  BG42: ["Pazardzhik", "Plovdiv", "Smolyan", "Kardzhali", "Haskovo"],
};
const NUTS2_NAMES = {
  BG31: "Northwestern",
  BG32: "North Central",
  BG33: "Northeastern",
  BG34: "Southeastern",
  BG41: "Southwestern",
  BG42: "South Central",
};

// Same simplification/rounding pipeline as build-yu-geo.mjs: arcs simplified
// IN THE TOPOLOGY (Visvalingam, endpoints pinned) so shared province borders
// stay consistent; threshold in deg² of triangle area; coords round to 4
// decimals.
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

const bgr = await fetchGB("BGR", "ADM1");
if (bgr.features.length !== 28)
  throw new Error(`BGR ADM1: expected 28 provinces, got ${bgr.features.length}`);
function writeShard(provinces, names, filename) {
  const provinceToRegion = new Map();
  for (const [regionId, members] of Object.entries(provinces)) {
    for (const name of members) {
      if (provinceToRegion.has(name)) throw new Error(`${filename}: duplicate province ${name}`);
      provinceToRegion.set(name, regionId);
    }
  }
  const objects = {};
  const counts = {};
  for (const feature of bgr.features) {
    const name = feature.properties?.shapeName;
    const regionId = provinceToRegion.get(name);
    if (!regionId) throw new Error(`${filename}: unmapped province ${JSON.stringify(name)}`);
    (objects[regionId] ??= { type: "FeatureCollection", features: [] }).features.push(feature);
    counts[regionId] = (counts[regionId] ?? 0) + 1;
  }
  for (const [regionId, members] of Object.entries(provinces))
    if (counts[regionId] !== members.length)
      throw new Error(`${filename}: ${regionId} matched ${counts[regionId]} of ${members.length}`);
  // Unquantized topology keeps absolute arc coordinates for shared-border simplification.
  const topo = topology(objects);
  topo.arcs = topo.arcs.map(simplifyArc);
  const out = Object.entries(names).map(([regionId, na]) => {
    const geometry = rewind(roundGeometry(topoMerge(topo, [topo.objects[regionId]])));
    return {
      type: "Feature",
      id: regionId,
      properties: { id: regionId, na, regionCode: regionId },
      geometry,
    };
  });
  out.sort((a, b) => a.properties.regionCode.localeCompare(b.properties.regionCode));
  const json = JSON.stringify({ type: "FeatureCollection", features: out });
  writeFileSync(pub(filename), json + "\n");
  console.log(`wrote ${filename}: ${out.length} features (${(json.length / 1024).toFixed(0)}KB)`);
}

writeShard(REGION_PROVINCES, REGION_NAMES, "bg-regions.json");
writeShard(NUTS2_PROVINCES, NUTS2_NAMES, "bg-regions-2027.json");
