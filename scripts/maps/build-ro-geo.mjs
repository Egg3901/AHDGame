// Build public/ro-regions.json from Romania's 42 judete (41 counties +
// Bucharest) — dissolve them into the game's 7 historic provinces
// (RO_REGION_CODES, matching src/lib/seeds/ro/roRegions.ts). Judete are
// dissolved through ONE shared topojson topology so adjacent provinces share
// border arcs and union cleanly into one Romania blob on the /world overlay
// (see build-brazil-geo.mjs). Judete boundaries are stable enough across both
// presets that the dissolved province outlines are era-correct.
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE
// in (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a
// CCW outer ring as "the globe minus the shape".
//
// Source: geoBoundaries gbOpen ROU ADM1 (properties.shapeName).
// Run: node scripts/maps/build-ro-geo.mjs
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

// English names some datasets use.
const ALIASES = {
  bucharest: "bucuresti",
  bucharestmunicipality: "bucuresti",
  municipiulbucuresti: "bucuresti",
};

const REGIONS = {
  RO_BUC: { na: "Bucharest", units: ["București", "Ilfov"] },
  RO_MUN: {
    na: "Muntenia",
    units: [
      "Argeș",
      "Brăila",
      "Buzău",
      "Călărași",
      "Dâmbovița",
      "Giurgiu",
      "Ialomița",
      "Prahova",
      "Teleorman",
    ],
  },
  RO_OLT: { na: "Oltenia", units: ["Dolj", "Gorj", "Mehedinți", "Olt", "Vâlcea"] },
  RO_TRA: {
    na: "Transylvania",
    units: [
      "Alba",
      "Bistrița-Năsăud",
      "Brașov",
      "Cluj",
      "Covasna",
      "Harghita",
      "Hunedoara",
      "Mureș",
      "Sălaj",
      "Sibiu",
    ],
  },
  RO_VST: {
    na: "Banat & Crișana",
    units: ["Arad", "Bihor", "Caraș-Severin", "Timiș", "Satu Mare", "Maramureș"],
  },
  RO_MOL: {
    na: "Moldavia",
    units: ["Bacău", "Botoșani", "Galați", "Iași", "Neamț", "Suceava", "Vaslui", "Vrancea"],
  },
  RO_DOB: { na: "Dobruja", units: ["Constanța", "Tulcea"] },
};

const UNIT_TO_REGION = new Map();
for (const [regionId, { units }] of Object.entries(REGIONS))
  for (const u of units) UNIT_TO_REGION.set(fold(u), regionId);
if (UNIT_TO_REGION.size !== 42)
  throw new Error(`judet table has ${UNIT_TO_REGION.size} entries, expected 42`);

// Same simplification/rounding pipeline as build-yu-geo.mjs: arcs simplified
// IN THE TOPOLOGY (Visvalingam, endpoints pinned) so shared judet borders stay
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

// Drop degenerate sliver polygons (deg²; ~1 km²) — digitization noise; the
// Danube-delta islets worth keeping are far larger. Never applied to holes.
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

const rou = await fetchGB("ROU", "ADM1");
if (rou.features.length !== 42)
  throw new Error(`ROU ADM1: expected 42 judete, got ${rou.features.length}`);

const objects = {};
const seen = new Set();
for (const f of rou.features) {
  const raw = f.properties?.shapeName;
  if (!raw) throw new Error(`ROU judet with no shapeName`);
  const folded = fold(raw).replace(/county$/, "");
  const key = ALIASES[folded] ?? folded;
  const regionId = UNIT_TO_REGION.get(key);
  if (!regionId) throw new Error(`unmapped judet: "${raw}" (folded: ${folded})`);
  if (seen.has(key)) throw new Error(`duplicate judet: "${raw}"`);
  seen.add(key);
  (objects[regionId] ??= { type: "FeatureCollection", features: [] }).features.push(f);
}
if (seen.size !== 42) throw new Error(`consumed ${seen.size} judete, expected 42`);

// Unquantized topology: arcs keep absolute coordinates, so they can be
// simplified in place (a quantized topology delta-encodes arcs).
const topo = topology(objects);
topo.arcs = topo.arcs.map(simplifyArc);

const out = [];
for (const [regionId, { na }] of Object.entries(REGIONS)) {
  const obj = topo.objects[regionId];
  if (!obj) throw new Error(`no judete mapped to ${regionId}`);
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
writeFileSync(pub("ro-regions.json"), json + "\n");
console.log(
  `wrote ${out.length} features (${(json.length / 1024).toFixed(0)}KB): ${out
    .map((f) => f.properties.regionCode)
    .join(", ")}`
);
