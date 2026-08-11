// Build public/dd-regions.json — East Berlin (`BEO`), the one DD gameplay
// region with no shape in the germany shard (BE is West Berlin; Brandenburg
// carries Berlin as an interior enclave hole). Both Cold-War presets seed DD
// on the eastern-Länder codes, so MV/BB/ST/SN/TH render from the germany shard
// by ownership — this shard only supplies the Berlin outline for BEO, taken
// from Brandenburg's interior ring (it fills BB's hole exactly).
//
// Source: public/germany-regions.json (already regionCode-tagged, built by
// build-germany-geo.mjs). No network. Deterministic.
// Run: node scripts/maps/build-dd-geo.mjs
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

const germany = JSON.parse(readFileSync(pub("germany-regions.json"), "utf8"));
const bb = germany.features.find((f) => f.properties.regionCode === "BB");
if (!bb || bb.geometry.type !== "Polygon" || bb.geometry.coordinates.length < 2) {
  throw new Error("expected BB to be a Polygon with an interior Berlin ring");
}

// Brandenburg's interior ring is the Berlin outline; reverse to outer winding.
const out = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { regionCode: "BEO" },
      geometry: { type: "Polygon", coordinates: [[...bb.geometry.coordinates[1]].reverse()] },
    },
  ],
};
writeFileSync(pub("dd-regions.json"), JSON.stringify(out));
console.log("wrote public/dd-regions.json — 1 feature: BEO");
