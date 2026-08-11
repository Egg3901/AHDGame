// Build public/germany-regions.json from public/de-laender.json — one
// FeatureCollection of all 16 German Länder, each feature tagged
// properties.regionCode (= the game's states._id). Region identity is the code;
// which country it renders under (DE in unified eras, DE+DD in 1979) is read live
// from states.countryId — the same ownership-driven model as the British Isles.
//
// All 16 Länder are kept distinct, INCLUDING Berlin (BE) as its own feature, so
// the country (/country/de/map) map can draw West Berlin as its own region.
// Brandenburg (BB) keeps its Berlin-shaped interior ring. On the WORLD overlay,
// Berlin's territory should follow Brandenburg (East in 1979) — that fold happens
// at overlay time (WorldMapSVG remaps the BE feature to Brandenburg's owner, which
// also fills BB's hole), NOT in this geometry. de-laender already uses the game's
// codes (BRE for Bremen — HB is CN's Huabei; BE for Berlin), so regionCode = id.
//
// Deterministic (sorted by regionCode).
//   Run: node scripts/maps/build-germany-geo.mjs
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const de = JSON.parse(readFileSync(pub("de-laender.json"), "utf8"));

const out = de.features
  .map((f) => {
    const code = f.properties.id;
    return {
      type: "Feature",
      id: code,
      properties: { regionCode: code, na: f.properties.na },
      geometry: f.geometry,
    };
  })
  .sort((a, b) => a.properties.regionCode.localeCompare(b.properties.regionCode));

writeFileSync(
  pub("germany-regions.json"),
  JSON.stringify({ type: "FeatureCollection", features: out }) + "\n"
);
console.log(`wrote ${out.length} features: ${out.map((f) => f.properties.regionCode).join(", ")}`);
