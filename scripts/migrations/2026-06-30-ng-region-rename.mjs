/**
 * Rename Nigeria's six zones from the old LARP labels (The Sahel / The Frontier /
 * Middle Belt / The West / The Delta / The East) to the official geopolitical-zone
 * names, matching the renamed seed (ngRegions*.ts). Updates `states.name` and
 * `states.region` for countryId "NG".
 *
 * Only the `states` collection persists these display names — the maps key on
 * `_id`/regionCode and read names live from `states`; statePartyOrg/elections/
 * officials key on `_id`, not the display name (verified on live before writing).
 *
 * Guarded:
 *   - DRY RUN by default. `--apply` to mutate.
 *   - `--live` targets MONGODB_URI_LIVE (else MONGODB_URI / dev).
 *   - Keyed by zone `_id` → idempotent (skips rows already at the target name).
 */

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const args = new Set(process.argv.slice(2));
const useLive = args.has("--live");
const apply = args.has("--apply");

const uri = useLive ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
if (!uri) {
  console.error(`MISSING env: ${useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI"} not set`);
  process.exit(1);
}

// Zone _id → official geopolitical-zone display name.
const ZONE_NAMES = {
  NORTH_WEST: "North-West",
  NORTH_EAST: "North-East",
  NORTH_CENTRAL: "North-Central",
  SOUTH_WEST: "South-West",
  SOUTH_SOUTH: "South-South",
  SOUTH_EAST: "South-East",
};

const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db();
  console.log(`Target: ${useLive ? "LIVE" : "local"} db "${db.databaseName}"`);

  const states = await db
    .collection("states")
    .find({ countryId: "NG" })
    .project({ _id: 1, name: 1, region: 1 })
    .toArray();

  if (states.length === 0) {
    console.log("No NG states found. Nothing to do.");
  } else {
    const ops = [];
    for (const s of states) {
      const target = ZONE_NAMES[s._id];
      if (!target) {
        console.warn(`  ⚠ SKIP ${s._id}: not a known NG zone _id`);
        continue;
      }
      if (s.name === target && s.region === target) {
        console.log(`  ✓ ${String(s._id).padEnd(14)} already "${target}"`);
        continue;
      }
      console.log(
        `  → ${String(s._id).padEnd(14)} name "${s.name}"→"${target}", region "${s.region}"→"${target}"`
      );
      ops.push({
        updateOne: { filter: { _id: s._id }, update: { $set: { name: target, region: target } } },
      });
    }

    if (ops.length === 0) {
      console.log("\nAll NG zones already renamed. Nothing to do.");
    } else if (!apply) {
      console.log(
        `\nDRY RUN (${useLive ? "LIVE" : "local"}). Would update ${ops.length} zone(s). Re-run with --apply to mutate.`
      );
    } else {
      console.log(`\nAPPLYING (${useLive ? "LIVE" : "local"})...`);
      const result = await db.collection("states").bulkWrite(ops);
      console.log(`Done. modifiedCount=${result.modifiedCount}`);
    }
  }
} finally {
  await client.close();
}
