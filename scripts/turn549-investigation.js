require("dotenv").config({ path: "./.env.local" });
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  // Check adminLogs around turn 549
  console.log("=== ADMIN LOGS AROUND TURN 549 ===");
  // Turns are ~2h apart, turn 549 would be around currentTurn-4
  // currentTurn is 553, so turn 549 is ~8h ago
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const adminLogs = await db
    .collection("adminLogs")
    .find({ createdAt: { $gte: cutoff } })
    .sort({ createdAt: 1 })
    .limit(50)
    .toArray();
  for (const log of adminLogs) {
    const ts = log.createdAt?.toISOString?.() ?? "?";
    if (/energ|nation|sector|auto.?seed|boost|commodity/i.test(JSON.stringify(log))) {
      console.log(
        `  ${ts}: category=${log.category}, action=${log.action}, user=${log.username}, details=${JSON.stringify(log.details).slice(0, 200)}`
      );
    }
  }

  // Check all admin logs in the window, not just filtered
  console.log("\n=== ALL ADMIN LOGS (last 12h, first 30) ===");
  for (const log of adminLogs.slice(0, 30)) {
    const ts = log.createdAt?.toISOString?.() ?? "?";
    console.log(`  ${ts}: category=${log.category}, action=${log.action}, user=${log.username}`);
  }

  // Check if auto-seed ran around turn 549
  const gs = await db.collection("gameState").findOne({ _id: "current" });
  console.log(`\n=== GAME STATE ===`);
  console.log(`currentTurn: ${gs.currentTurn}`);
  console.log(`autoSectorSeedEnabled: ${gs.autoSectorSeedEnabled}`);
  console.log(`lastAutoSeedTurn: ${gs.lastAutoSeedTurn}`);

  // auto-seed runs every 48 turns. lastAutoSeedTurn=512, so next would be 560.
  // But 549 is between 512 and 560 — so auto-seed shouldn't have run at 549.
  // Unless something else happened.

  // Check bills around turn 547-549
  console.log("\n=== UK BILLS AROUND TURN 547-549 ===");
  // Bills don't store turn directly in a queryable field sometimes
  // Let's check by enactedAt timestamp
  const bills = await db.collection("bills").find({ countryId: "UK", status: "signed" }).toArray();
  for (const bill of bills) {
    const enacted = bill.enactedAt;
    if (enacted) {
      const ts = new Date(enacted).toISOString();
      // Check if it's recent (within last ~20 turns = ~40h)
      const age = Date.now() - new Date(enacted).getTime();
      if (age < 50 * 60 * 60 * 1000) {
        console.log(
          `  "${bill.title}", enacted=${ts}, votingEndsOnTurn=${bill.votingEndsOnTurn}, provisions=${JSON.stringify(bill.provisions?.map((p) => p.type)).slice(0, 100)}`
        );
      }
    }
  }

  // Check ALL countries' bills around that time
  console.log("\n=== ALL COUNTRY BILLS (enacted in last 50h) ===");
  const recentBills = await db
    .collection("bills")
    .find({ status: "signed", enactedAt: { $gte: new Date(Date.now() - 50 * 60 * 60 * 1000) } })
    .toArray();
  for (const bill of recentBills) {
    console.log(
      `  ${bill.countryId}: "${bill.title}", enacted=${new Date(bill.enactedAt).toISOString()}, provisions=${JSON.stringify(bill.provisions?.map((p) => ({ type: p.type, target: p.targetSectorType })))}`
    );
  }

  // Check commodityPriceHistory more granularly around 547-550
  console.log("\n=== ENERGY HISTORY (turns 545-553) ===");
  for (let t = 545; t <= 553; t++) {
    const doc = await db
      .collection("commodityPriceHistory")
      .findOne({ commodity: "energy", turn: t });
    if (doc) {
      console.log(
        `  turn=${t}: global=${doc.globalSupply?.toFixed(0)}, demand=${doc.globalDemand?.toFixed(0)}, nationalSupply=${JSON.stringify(doc.nationalSupply || {}).slice(0, 150)}`
      );
    }
  }

  // Check what the UK natcorp energy sectors looked like at different backup points
  console.log("\n=== CHECKING MULTIPLE BACKUPS FOR UK NATCORP ENERGY ===");
  const fs = require("fs");
  const { BSON } = require("bson");
  const backupDir = "/root/a-house-divided-backups";
  const backupDirs = fs
    .readdirSync(backupDir)
    .filter((e) => e.match(/^\d{4}-\d{2}-\d{2}_/))
    .sort();

  // Check a few key backups
  const checkBackups = [
    backupDirs[0], // earliest
    backupDirs[Math.floor(backupDirs.length * 0.5)], // middle
    backupDirs[backupDirs.length - 1], // latest
  ].filter(Boolean);

  for (const bdir of checkBackups) {
    const sectorsPath = `${backupDir}/${bdir}/a-house-divided/corporateSectors.bson`;
    if (!fs.existsSync(sectorsPath)) continue;
    const bsonData = fs.readFileSync(sectorsPath);
    let offset = 0;
    let totalEnergy = 0;
    let energyCount = 0;
    let totalDefense = 0;
    let defenseCount = 0;
    while (offset < bsonData.length) {
      const size = bsonData.readInt32LE(offset);
      if (size < 5 || offset + size > bsonData.length) break;
      const doc = BSON.deserialize(bsonData.subarray(offset, offset + size));
      if (doc.corporationId && doc.corporationId.toString() === "700000000000000000000001") {
        if (doc.sectorType === "energy") {
          totalEnergy += doc.revenue || 0;
          energyCount++;
        }
        if (doc.sectorType === "defense") {
          totalDefense += doc.revenue || 0;
          defenseCount++;
        }
      }
      offset += size;
    }
    console.log(
      `  ${bdir}: energy=${energyCount} sectors, £${totalEnergy.toLocaleString()}; defense=${defenseCount} sectors, £${totalDefense.toLocaleString()}`
    );
  }

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
