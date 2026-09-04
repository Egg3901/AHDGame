/**
 * READ-ONLY. Do the National Corporation split-offs that the #1271 retype heal
 * would touch actually hold tech-tree unlocks, decade lane commitments, or
 * strength grants that a primary-type switch would drop?
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });
const raw = process.env.MONGODB_URI_LIVE;
const uri = raw.includes("directConnection")
  ? raw
  : raw + (raw.includes("?") ? "&" : "?") + "directConnection=true";

const client = new MongoClient(uri);
await client.connect();
const db = client.db();

const corps = await db
  .collection("corporations")
  .find({ countryOwnerId: { $type: "string" }, isPrimaryNationalCorporation: { $ne: true } })
  .project({
    name: 1,
    countryOwnerId: 1,
    type: 1,
    assignedSectorTypes: 1,
    unlockedTechNodeIds: 1,
    techDecadeLane: 1,
    marketingStrength: 1,
    logisticsStrength: 1,
    rdScore: 1,
    totalShares: 1,
    soe: 1,
  })
  .toArray();

const mistyped = corps.filter(
  (c) => (c.assignedSectorTypes || []).length === 1 && c.type !== c.assignedSectorTypes[0]
);

console.log("country-owned non-primary corps:", corps.length);
console.log("would be retyped by the heal:", mistyped.length);

let withTech = 0;
let withLane = 0;
let withStrength = 0;
let withRd = 0;
console.log("\nname | country | type -> want | unlocks | laneKeys | mkt/log | rdScore");
for (const c of mistyped) {
  const unlocks = c.unlockedTechNodeIds || [];
  const lanes = Object.keys(c.techDecadeLane || {});
  const strength = (c.marketingStrength || 0) + (c.logisticsStrength || 0);
  if (unlocks.length) withTech++;
  if (lanes.length) withLane++;
  if (strength > 0) withStrength++;
  if ((c.rdScore || 0) > 0) withRd++;
  console.log(
    `${c.name} | ${c.countryOwnerId} | ${c.type} -> ${c.assignedSectorTypes[0]} | ${unlocks.length} | ${lanes.length} | ${c.marketingStrength || 0}/${c.logisticsStrength || 0} | ${c.rdScore || 0}`
  );
}

console.log("\n=== SUMMARY ===");
console.log("with unlockedTechNodeIds:", withTech);
console.log("with techDecadeLane:", withLane);
console.log("with marketing/logistics strength:", withStrength);
console.log("with rdScore > 0:", withRd);

console.log("\n=== sample of any unlock ids present ===");
for (const c of mistyped) {
  const u = c.unlockedTechNodeIds || [];
  if (u.length) console.log(`  ${c.name}: ${u.slice(0, 8).join(", ")}`);
}

await client.close();
