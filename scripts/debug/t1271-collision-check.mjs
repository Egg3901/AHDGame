/**
 * READ-ONLY. Does the upstream `lookupStateResourceCapacity` fallback (take the
 * alphabetically-first country that defines the bare state code) ever pick the
 * WRONG country's deposits on the live world?
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";
import { readFileSync } from "fs";

config({ path: ".env.local" });

// Parse the reference map's keys straight out of the source, so this does not
// depend on the merge being resolved yet.
const src = readFileSync("src/lib/seeds/reference/stateResourceCapacity.ts", "utf8");
const keys = [...src.matchAll(/^\s*"([A-Z_]+):([A-Z_0-9]+)":/gm)].map((m) => ({
  countryId: m[1],
  stateId: m[2],
}));

const byState = new Map();
for (const k of keys) {
  if (!byState.has(k.stateId)) byState.set(k.stateId, new Set());
  byState.get(k.stateId).add(k.countryId);
}

console.log("map keys parsed:", keys.length, "| distinct state codes:", byState.size);

console.log("\n=== state codes defined by MORE THAN ONE country ===");
const collisions = [...byState.entries()].filter(([, cs]) => cs.size > 1);
for (const [stateId, cs] of collisions) {
  const sorted = [...cs].sort();
  console.log(`  ${stateId}: ${sorted.join(", ")}  -> fallback would pick ${sorted[0]}`);
}
if (collisions.length === 0) console.log("  (none)");

const uri = process.env.MONGODB_URI_LIVE;
const client = new MongoClient(
  uri.includes("directConnection") ? uri : uri + (uri.includes("?") ? "&" : "?") + "directConnection=true"
);
await client.connect();
const db = client.db();
const states = await db
  .collection("states")
  .find({}, { projection: { countryId: 1 } })
  .toArray();

console.log("\n=== live states that would INHERIT another country's deposits ===");
console.log("(no entry under their own country, but the bare code exists elsewhere)");
let wrong = 0;
for (const s of states) {
  const owners = byState.get(s._id);
  if (!owners) continue; // code unknown to the map: still resolves to {}
  if (owners.has(s.countryId)) continue; // exact key hits, fallback never runs
  const picked = [...owners].sort()[0];
  wrong++;
  console.log(`  ${s.countryId}/${s._id}: would inherit ${picked}:${s._id}`);
}
if (wrong === 0) console.log("  (none)");

console.log("\n=== of those, how many are the German merge (correct) vs other (wrong) ===");
console.log("total inheriting:", wrong);

await client.close();
