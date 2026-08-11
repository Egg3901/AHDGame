// Build public/japan-regions.json from public/japan-prefectures.json — dissolve
// the 47 prefectures into the 8 game macro-regions (matching japan.ts), each
// output feature tagged properties.regionCode (= the game's states._id). This is
// the geometry source for the generic RegionalGeoMap; the per-feature merge
// mirrors what JapanMapPaths does at runtime, done once at build time instead.
//
// PREF_TO_REGION / REGION_IDS / REGION_LABELS are COPIED VERBATIM from
// src/components/JapanMapPaths.tsx — the two MUST agree. japanGeometry.test.ts
// asserts the output's 8 codes == JP_REGION_CODES, catching drift.
//
// Deterministic (sorted by regionCode). Run: node scripts/maps/build-japan-geo.mjs
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { merge } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

// prefecture code (1–47) → game region id
const PREF_TO_REGION = {
  1: "HOK",
  2: "TOH",
  3: "TOH",
  4: "TOH",
  5: "TOH",
  6: "TOH",
  7: "TOH",
  8: "KAN",
  9: "KAN",
  10: "KAN",
  11: "KAN",
  12: "KAN",
  13: "KAN",
  14: "KAN",
  15: "CHU",
  16: "CHU",
  17: "CHU",
  18: "CHU",
  19: "CHU",
  20: "CHU",
  21: "CHU",
  22: "CHU",
  23: "CHU",
  24: "KNS",
  25: "KNS",
  26: "KNS",
  27: "KNS",
  28: "KNS",
  29: "KNS",
  30: "KNS",
  31: "CGK",
  32: "CGK",
  33: "CGK",
  34: "CGK",
  35: "CGK",
  36: "SHI",
  37: "SHI",
  38: "SHI",
  39: "SHI",
  40: "KYU",
  41: "KYU",
  42: "KYU",
  43: "KYU",
  44: "KYU",
  45: "KYU",
  46: "KYU",
  47: "KYU",
};

const REGION_IDS = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"];
const REGION_LABELS = {
  HOK: "Hokkaido",
  TOH: "Tohoku",
  KAN: "Kanto",
  CHU: "Chubu",
  KNS: "Kansai",
  CGK: "Chugoku",
  SHI: "Shikoku",
  KYU: "Kyushu",
};

const topo = JSON.parse(readFileSync(pub("japan-prefectures.json"), "utf8"));
const japanObj = topo.objects.japan;
if (!japanObj?.geometries)
  throw new Error("japan-prefectures.json: missing objects.japan.geometries");

// Group prefecture geometries by region.
const byRegion = new Map();
for (const geom of japanObj.geometries) {
  const prefId = geom.properties?.id;
  const regionId = PREF_TO_REGION[prefId];
  if (!regionId) continue;
  const arr = byRegion.get(regionId) ?? [];
  arr.push(geom);
  byRegion.set(regionId, arr);
}

// Merge each region's prefectures into one polygon (lon/lat), tag regionCode.
const out = [];
for (const regionId of REGION_IDS) {
  const geoms = byRegion.get(regionId);
  if (!geoms || geoms.length === 0) throw new Error(`no prefectures mapped to region ${regionId}`);
  const geometry = merge(topo, geoms);
  out.push({
    type: "Feature",
    id: regionId,
    properties: { regionCode: regionId, na: REGION_LABELS[regionId] },
    geometry,
  });
}
out.sort((a, b) => a.properties.regionCode.localeCompare(b.properties.regionCode));

writeFileSync(
  pub("japan-regions.json"),
  JSON.stringify({ type: "FeatureCollection", features: out }) + "\n"
);
console.log(`wrote ${out.length} features: ${out.map((f) => f.properties.regionCode).join(", ")}`);
