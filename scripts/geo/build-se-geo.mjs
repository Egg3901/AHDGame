// Build public/se-regions.json from Sweden's 21 counties (län) — dissolve them
// into the game's 8 macro-regions (SE_REGION_CODES, matching
// src/lib/seeds/se/seRegions.ts). Counties are dissolved through ONE shared
// topojson topology so adjacent macro-regions share border arcs and union
// cleanly into one Sweden blob on the /world overlay (see build-brazil-geo.mjs).
//
// Modern county boundaries dissolve to era-correct macro-region outlines: the
// 1990s county mergers (Västra Götaland, Skåne) happened INSIDE single game
// regions, so the dissolved outlines are identical for 1953/1979.
//
// Output winding is normalized to the repo convention: outer rings CLOCKWISE
// in (lon,lat), holes CCW — d3-geo interprets rings spherically and renders a
// CCW outer ring as "the globe minus the shape".
//
// Sources (first that works): geoBoundaries SWE ADM1 (properties.shapeName),
// Click-that-Hood sweden-counties (properties.name).
// Network: fetches the upstream GeoJSON. Deterministic (sorted by regionCode).
// Run: node scripts/maps/build-se-geo.mjs
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const SOURCES = [
  {
    name: "geoBoundaries SWE ADM1",
    url: "https://www.geoboundaries.org/api/current/gbOpen/SWE/ADM1/",
    nameProp: (p) => p?.shapeName,
    indirect: true, // API returns metadata; the GeoJSON itself is at .gjDownloadURL
  },
  {
    name: "click-that-hood sweden-counties",
    url: "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/sweden-counties.geojson",
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

// Historic/merged county names some datasets use — each maps onto the modern
// county whose game region contains it (all pre-merger counties sit inside a
// single game region, so this is lossless).
const ALIASES = {
  goteborgochbohus: "vastragotaland",
  alvsborg: "vastragotaland",
  skaraborg: "vastragotaland",
  malmohus: "skane",
  kristianstad: "skane",
  kopparberg: "dalarna",
};

const REGIONS = {
  SE_STH: { na: "Stockholm", units: ["Stockholm"] },
  SE_GOT: { na: "Western Sweden", units: ["Västra Götaland", "Halland"] },
  SE_SKA: { na: "Skåne", units: ["Skåne"] },
  SE_EAS: { na: "Eastern Sweden", units: ["Östergötland", "Södermanland", "Gotland"] },
  SE_SML: { na: "Småland", units: ["Jönköping", "Kronoberg", "Kalmar", "Blekinge"] },
  SE_VML: { na: "Bergslagen", units: ["Värmland", "Örebro", "Västmanland"] },
  SE_NOR: {
    na: "Norrland",
    units: ["Gävleborg", "Västernorrland", "Jämtland", "Västerbotten", "Norrbotten"],
  },
  SE_UPP: { na: "Uppland & Dalarna", units: ["Uppsala", "Dalarna"] },
};

const UNIT_TO_REGION = new Map();
for (const [regionId, { units }] of Object.entries(REGIONS))
  for (const u of units) UNIT_TO_REGION.set(fold(u), regionId);
if (UNIT_TO_REGION.size !== 21)
  throw new Error(`county table has ${UNIT_TO_REGION.size} entries, expected 21`);

// County sources are dense: arcs are simplified IN THE TOPOLOGY (Visvalingam,
// endpoints pinned), so a shared border simplifies identically for both
// neighbors and the macro-regions still union cleanly on the world map.
// Threshold in deg² of triangle area; output coords round to 4 decimals.
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
// scales. Keeps Gotland/Öland; sheds archipelago specks.
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
  // County names come in "X", "X län", "Xs län", "X County" variants — try the
  // raw fold plus suffix-stripped forms.
  const folded = fold(raw);
  const candidates = [
    folded,
    folded.replace(/county$/, ""),
    folded.replace(/slan$/, ""),
    folded.replace(/lan$/, ""),
  ].map((c) => ALIASES[c] ?? c);
  const key = candidates.find((c) => UNIT_TO_REGION.has(c));
  if (key === undefined)
    throw new Error(`unmapped county: "${raw}" (tried: ${candidates.join(", ")})`);
  const regionId = UNIT_TO_REGION.get(key);
  if (seen.has(key)) throw new Error(`duplicate county: "${raw}"`);
  seen.add(key);
  (objects[regionId] ??= { type: "FeatureCollection", features: [] }).features.push(f);
}
if (seen.size !== 21) throw new Error(`consumed ${seen.size} counties, expected 21`);

// Unquantized topology: arcs keep absolute coordinates, so they can be
// simplified in place (a quantized topology delta-encodes arcs).
const topo = topology(objects);
topo.arcs = topo.arcs.map(simplifyArc);

const out = [];
for (const [regionId, { na }] of Object.entries(REGIONS)) {
  const obj = topo.objects[regionId];
  if (!obj) throw new Error(`no counties mapped to ${regionId}`);
  // topoMerge dissolves the macro-region's counties, removing internal shared arcs.
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
writeFileSync(pub("se-regions.json"), json + "\n");
console.log(
  `wrote ${out.length} features (${(json.length / 1024).toFixed(0)}KB): ${out
    .map((f) => f.properties.regionCode)
    .join(", ")}`
);
