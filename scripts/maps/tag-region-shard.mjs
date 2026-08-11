// Tag an existing region GeoJSON FeatureCollection with `properties.regionCode`
// (= the feature's existing `id`, which is already the game's states._id for the
// region-level shards: CN DB/HB/…, BR NORTE/…). This makes the file usable by the
// generic RegionalGeoMap (which keys on `properties.regionCode`) WITHOUT breaking
// the bespoke RegionMapPaths consumers that still read `properties.id`/`na`.
//
// Idempotent (re-running is a no-op) and order-preserving (minimal diff). Run:
//   node scripts/maps/tag-region-shard.mjs public/br-regions.json [more.json ...]
import { readFileSync, writeFileSync } from "fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/maps/tag-region-shard.mjs <file.json> [...]");
  process.exit(1);
}

for (const file of files) {
  const fc = JSON.parse(readFileSync(file, "utf8"));
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    console.error(`skip ${file}: not a FeatureCollection`);
    process.exit(1);
  }
  let tagged = 0;
  for (const f of fc.features) {
    const id = f.properties?.id ?? f.id;
    if (id == null || id === "") {
      console.error(`skip ${file}: a feature has no id to derive regionCode from`);
      process.exit(1);
    }
    const code = String(id);
    f.properties = { ...f.properties, regionCode: code };
    tagged++;
  }
  writeFileSync(file, JSON.stringify(fc) + "\n");
  const codes = fc.features.map((f) => f.properties.regionCode).join(", ");
  console.log(`tagged ${tagged} features in ${file}: ${codes}`);
}
