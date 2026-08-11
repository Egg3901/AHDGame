// Build public/hu-regions.json — Hungary's six regions (Budapest, Pest,
// Western & Southern Transdanubia, Northern Hungary, Great Plain), matching
// src/lib/seeds/hu/huRegions.ts.
//
// Source: Natural Earth 10m admin-1 (public domain), filtered to HUN — the
// only open dataset that ships Budapest as its own unit (geoBoundaries ADM1
// folds the capital into Pest). NE models Hungary as 43 units: 19 counties +
// Budapest + 23 city-counties; each city-county maps to its host county's
// region, so the dissolve tiles the country exactly. Names are matched
// ascii-folded (NE writes ô for ő: Gyôr, Hódmezôvásárhely).
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE
// in (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a
// CCW outer ring as "the globe minus the shape".
// Run: node scripts/maps/build-hu-geo.mjs
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const NE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson";

// Ascii-fold lowercase so NE spelling variants key the same.
const fold = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");

// Region ← counties + the city-counties inside them (folded names).
const REGION_UNITS = {
  HU_BUD: { na: "Budapest", units: ["Budapest"] },
  HU_PES: { na: "Pest", units: ["Pest", "Érd"] },
  HU_TRW: {
    na: "Western Transdanubia",
    units: [
      "Győr-Moson-Sopron",
      "Sopron",
      "Győr",
      "Vas",
      "Szombathely",
      "Zala",
      "Zalaegerszeg",
      "Nagykanizsa",
      "Komárom-Esztergom",
      "Tatabánya",
      "Veszprém",
      "Fejér",
      "Székesfehérvár",
      "Dunaújváros",
    ],
  },
  HU_TRS: {
    na: "Southern Transdanubia",
    units: ["Baranya", "Pécs", "Somogy", "Kaposvár", "Tolna", "Szekszárd"],
  },
  HU_NOR: {
    na: "Northern Hungary",
    units: ["Borsod-Abaúj-Zemplén", "Miskolc", "Heves", "Eger", "Nógrád", "Salgótarján"],
  },
  HU_ALF: {
    na: "Great Plain",
    units: [
      "Bács-Kiskun",
      "Kecskemét",
      "Békés",
      "Békéscsaba",
      "Csongrád",
      "Szeged",
      "Hódmezővásárhely",
      "Hajdú-Bihar",
      "Debrecen",
      "Jász-Nagykun-Szolnok",
      "Szolnok",
      "Szabolcs-Szatmár-Bereg",
      "Nyíregyháza",
    ],
  },
};

const UNIT_TO_REGION = new Map();
for (const [regionId, { units }] of Object.entries(REGION_UNITS))
  for (const u of units) UNIT_TO_REGION.set(fold(u), regionId);
// 42 distinct folded names cover the 43 NE features ("Veszprém" is both a
// county and a city-county; both belong to HU_TRW).
if (UNIT_TO_REGION.size !== 42)
  throw new Error(`unit table has ${UNIT_TO_REGION.size} entries, expected 42`);

// Same simplification/rounding pipeline as build-yu-geo.mjs: arcs simplified
// IN THE TOPOLOGY (Visvalingam, endpoints pinned) so shared county borders
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

const ne = await (await fetch(NE_URL)).json();
const hun = ne.features.filter((f) => (f.properties || {}).adm0_a3 === "HUN");
if (hun.features?.length === 0 || hun.length !== 43)
  throw new Error(`NE 10m admin-1: expected 43 HUN units, got ${hun.length}`);

const objects = {};
const counts = {};
for (const f of hun) {
  const name = f.properties?.name;
  const regionId = UNIT_TO_REGION.get(fold(name ?? ""));
  if (!regionId) throw new Error(`unmapped HUN unit: ${JSON.stringify(name)}`);
  (objects[regionId] ??= { type: "FeatureCollection", features: [] }).features.push(f);
  counts[regionId] = (counts[regionId] ?? 0) + 1;
}
console.log(
  `NE HUN → ${Object.entries(counts)
    .map(([r, c]) => `${r} (${c})`)
    .join(", ")}`
);

// Unquantized topology: arcs keep absolute coordinates, so they can be
// simplified in place (a quantized topology delta-encodes arcs).
const topo = topology(objects);
topo.arcs = topo.arcs.map(simplifyArc);

const out = [];
for (const [regionId, { na }] of Object.entries(REGION_UNITS)) {
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
writeFileSync(pub("hu-regions.json"), json + "\n");
console.log(
  `wrote ${out.length} features (${(json.length / 1024).toFixed(0)}KB): ${out
    .map((f) => f.properties.regionCode)
    .join(", ")}`
);
