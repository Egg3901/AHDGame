// Build public/usa-regions.json from public/us-states-10m.json (us-atlas TopoJSON):
// one GeoJSON FeatureCollection of the 50 states + DC, each feature tagged
// properties.regionCode = the game's 2-letter state code (= states._id). This is
// the geometry source for the generic RegionalGeoMap (rendered with geoAlbersUsa,
// which insets Alaska/Hawaii). Territories not in FIPS_TO_STATE are dropped.
//
// FIPS_TO_STATE is COPIED VERBATIM from src/components/USAMapPaths.tsx — the two
// MUST agree. usaGeometry.test.ts asserts the output's codes == US_REGION_CODES.
//
// Deterministic (sorted by regionCode). Run: node scripts/maps/build-usa-geo.mjs
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { feature } from "topojson-client";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

// FIPS state codes (us-atlas) → 2-letter state abbreviations (incl. DC).
const FIPS_TO_STATE = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  10: "DE",
  11: "DC",
  12: "FL",
  13: "GA",
  15: "HI",
  16: "ID",
  17: "IL",
  18: "IN",
  19: "IA",
  20: "KS",
  21: "KY",
  22: "LA",
  23: "ME",
  24: "MD",
  25: "MA",
  26: "MI",
  27: "MN",
  28: "MS",
  29: "MO",
  30: "MT",
  31: "NE",
  32: "NV",
  33: "NH",
  34: "NJ",
  35: "NM",
  36: "NY",
  37: "NC",
  38: "ND",
  39: "OH",
  40: "OK",
  41: "OR",
  42: "PA",
  44: "RI",
  45: "SC",
  46: "SD",
  47: "TN",
  48: "TX",
  49: "UT",
  50: "VT",
  51: "VA",
  53: "WA",
  54: "WV",
  55: "WI",
  56: "WY",
};

const topo = JSON.parse(readFileSync(pub("us-states-10m.json"), "utf8"));
const statesObj = topo.objects.states;
if (!statesObj) throw new Error("us-states-10m.json: missing objects.states");

const fc = feature(topo, statesObj); // FeatureCollection in lon/lat

const out = [];
for (const f of fc.features) {
  const fips = String(f.id ?? "").padStart(2, "0");
  const code = FIPS_TO_STATE[fips];
  if (!code) continue; // skip territories not modelled as game states
  out.push({
    type: "Feature",
    id: code,
    properties: { regionCode: code, na: f.properties?.name ?? code },
    geometry: f.geometry,
  });
}
out.sort((a, b) => a.properties.regionCode.localeCompare(b.properties.regionCode));

writeFileSync(
  pub("usa-regions.json"),
  JSON.stringify({ type: "FeatureCollection", features: out }) + "\n"
);
console.log(`wrote ${out.length} features: ${out.map((f) => f.properties.regionCode).join(",")}`);
