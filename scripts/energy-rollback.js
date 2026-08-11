require("dotenv").config({ path: "./.env.local" });
const { MongoClient, ObjectId } = require("mongodb");
const fs = require("fs");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  const corpId = new ObjectId("700000000000000000000001");

  // Current energy sectors
  const current = await db
    .collection("corporateSectors")
    .find({ corporationId: corpId, sectorType: "energy" })
    .toArray();

  console.log("=== CURRENT (live DB) ===");
  let currentTotal = 0;
  const currentMap = {};
  for (const s of current) {
    console.log(`${s.stateId}: revenue=${s.revenue} policy=${s.productionPolicyLevel}`);
    currentMap[s.stateId] = s.revenue;
    currentTotal += s.revenue;
  }
  console.log(`TOTAL: ${currentTotal}\n`);

  // Read backup BSON
  const backupFile =
    "/root/a-house-divided-backups/2026-06-21_04-53/a-house-divided/corporateSectors.bson";
  const bson = require("bson");

  // Use BSON streaming deserialization for multiple docs
  const bsonData = fs.readFileSync(backupFile);
  const backupSectors = [];

  // bson.deserialize handles a single document; for multiple docs in a .bson file,
  // we need to iterate through the buffer
  let offset = 0;
  while (offset < bsonData.length) {
    // Read the size of the next document (first 4 bytes, little-endian int32)
    const size = bsonData.readInt32LE(offset);
    if (size <= 0 || offset + size > bsonData.length) break;

    const docBuffer = bsonData.subarray(offset, offset + size);
    const doc = bson.deserialize(docBuffer, { promoteBuffers: false, promoteValues: true });

    if (
      doc.corporationId &&
      doc.corporationId.toString() === corpId.toString() &&
      doc.sectorType === "energy"
    ) {
      backupSectors.push(doc);
    }

    offset += size;
  }

  console.log(`=== BACKUP (June 21 04:53) — ${backupSectors.length} energy sectors ===`);
  let backupTotal = 0;
  const backupMap = {};
  for (const s of backupSectors) {
    console.log(`${s.stateId}: revenue=${s.revenue}`);
    backupMap[s.stateId] = s.revenue;
    backupTotal += s.revenue;
  }
  console.log(`TOTAL: ${backupTotal}\n`);

  // Rollback plan
  console.log("=== ROLLBACK PLAN ===");
  const updates = [];
  for (const s of current) {
    const oldRev = backupMap[s.stateId];
    if (oldRev === undefined) {
      console.log(`${s.stateId}: NOT IN BACKUP (current=${s.revenue}) — SKIP`);
    } else if (oldRev !== s.revenue) {
      console.log(`${s.stateId}: ${s.revenue} → ${oldRev} (delta: ${oldRev - s.revenue})`);
      updates.push({
        stateId: s.stateId,
        from: s.revenue,
        to: oldRev,
        filter: { corporationId: corpId, sectorType: "energy", stateId: s.stateId },
      });
    } else {
      console.log(`${s.stateId}: unchanged (${s.revenue})`);
    }
  }

  console.log(`\n${updates.length} sectors need rollback`);
  console.log(`Current total: ${currentTotal} → Target: ${backupTotal}`);

  // Print the update commands for verification
  console.log("\n=== UPDATE PAYLOADS ===");
  for (const u of updates) {
    console.log(`${u.stateId}: $set { revenue: ${u.to} }`);
  }

  await client.close();
  return { updates, currentTotal, backupTotal };
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
