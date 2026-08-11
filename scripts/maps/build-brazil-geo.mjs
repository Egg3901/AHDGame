// Build public/br-regions.json from Click-That-Hood's 27 Brazilian states —
// dissolve them into the 5 IBGE macro-regions (matching BR_REGION_CODES), each
// output feature tagged properties.regionCode (= the game's states._id). This is
// the geometry source for the generic RegionalGeoMap AND the /world overlay.
//
// WHY this script exists (and supersedes build-country-geojson.ts for BR): the 27
// states are dissolved through ONE shared topojson topology, so ADJACENT regions
// share the exact same border arcs and union cleanly into one Brazil blob on the
// world map. The old pipeline quantized at 1e3 (~4km), which shifted the NE coast
// off its shared border and split Brazil in two when unioned — finer quantization
// (7e3) keeps the shared borders intact. See regionManifest worldOverlay.
//
// Feature shape matches the legacy file: top-level `id` + properties {id, na,
// regionCode} so RegionMapPaths (legacy surfaces) and RegionalGeoMap both read it.
//
// Network: fetches the upstream GeoJSON. Deterministic (sorted by regionCode).
// Run: node scripts/maps/build-brazil-geo.mjs
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { topology } from "topojson-server";
import { merge as topoMerge } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const BR_STATES_URL =
  "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/brazil-states.geojson";

// Click-That-Hood `regiao_id` → game region id + display name. This source's
// numbering is NOT IBGE-standard (verified by each group's member states).
const REGIAO_TO_REGION = {
  1: { id: "SUL", na: "Sul" },
  2: { id: "SUDESTE", na: "Sudeste" },
  3: { id: "NORTE", na: "Norte" },
  4: { id: "NORDESTE", na: "Nordeste" },
  5: { id: "CENTRO_OESTE", na: "Centro-Oeste" },
};
const REGION_IDS = ["CENTRO_OESTE", "NORDESTE", "NORTE", "SUDESTE", "SUL"];

// Fine enough that adjacent states keep identical shared-border vertices (so the
// dissolved regions union cleanly into one Brazil — Q≤3e3 shifts the NE coast off
// its border and splits the country), coarse enough to keep the file web-sized.
const QUANTIZATION = 7e3;
// Drop coastal islands smaller than this (deg²; ~60 km²) — they're sub-pixel on
// both the nation map and the globe, and shedding ~120 specks keeps the merged
// blob to a handful of pieces (mainland + Marajó & the other sizable islands).
const MIN_ISLAND_AREA = 5e-3;

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++)
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a / 2);
};
const dropTinyIslands = (geometry) => {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const kept = polys.filter((poly) => ringArea(poly[0]) >= MIN_ISLAND_AREA);
  return kept.length === 1
    ? { type: "Polygon", coordinates: kept[0] }
    : { type: "MultiPolygon", coordinates: kept };
};

const src = await (await fetch(BR_STATES_URL)).json();
if (!src?.features?.length) throw new Error("brazil-states.geojson: no features");

// Group the 27 states by region; each region becomes one object in the topology.
const objects = {};
for (const f of src.features) {
  const m = REGIAO_TO_REGION[Number(f.properties?.regiao_id)];
  if (!m) {
    console.warn(`skip unmapped regiao_id=${f.properties?.regiao_id} (${f.properties?.name})`);
    continue;
  }
  (objects[m.id] ??= { type: "FeatureCollection", features: [] }).features.push(f);
}

const topo = topology(objects, QUANTIZATION);

const out = [];
for (const regionId of REGION_IDS) {
  const obj = topo.objects[regionId];
  if (!obj) throw new Error(`no states mapped to region ${regionId}`);
  // topoMerge dissolves the region's states, removing internal shared arcs.
  const geometry = dropTinyIslands(topoMerge(topo, [obj]));
  const na = Object.values(REGIAO_TO_REGION).find((r) => r.id === regionId)?.na ?? regionId;
  out.push({
    type: "Feature",
    id: regionId,
    properties: { id: regionId, na, regionCode: regionId },
    geometry,
  });
}
out.sort((a, b) => a.properties.regionCode.localeCompare(b.properties.regionCode));

writeFileSync(
  pub("br-regions.json"),
  JSON.stringify({ type: "FeatureCollection", features: out }) + "\n"
);
console.log(`wrote ${out.length} features: ${out.map((f) => f.properties.regionCode).join(", ")}`);
