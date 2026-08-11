require("dotenv").config({ path: "./.env.local" });
const { MongoClient, ObjectId } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  const corpId = new ObjectId("700000000000000000000001");

  // Rollback values from June 21 04:53 backup
  const rollbackValues = {
    EAE: 2248782,
    EMI: 2078485.0000000005,
    LON: 341342910.00000024,
    NEE: 2023661.0000000002,
    NIR: 2012564.9999999993,
    NWE: 90134666.99999996,
    SCO: 2134161.1377410595,
    SEE: 194710494.99999967,
    SWE: 99008561.99999996,
    WAL: 1948537.0000000002,
    WMI: 118662009.00000004,
    YHU: 2265286.7856247867,
  };

  console.log("Applying surgical rollback to 12 energy sectors...\n");

  for (const [stateId, revenue] of Object.entries(rollbackValues)) {
    const result = await db
      .collection("corporateSectors")
      .updateOne({ corporationId: corpId, sectorType: "energy", stateId }, { $set: { revenue } });
    if (result.modifiedCount === 1) {
      console.log(`✓ ${stateId}: revenue set to ${revenue}`);
    } else {
      console.log(`✗ ${stateId}: NO MATCH (modified=${result.modifiedCount})`);
    }
  }

  // Verify
  const after = await db
    .collection("corporateSectors")
    .find({ corporationId: corpId, sectorType: "energy" })
    .toArray();

  let total = 0;
  console.log("\n=== POST-ROLLBACK VERIFICATION ===");
  for (const s of after) {
    console.log(`${s.stateId}: revenue=${s.revenue} policy=${s.productionPolicyLevel}`);
    total += s.revenue;
  }
  console.log(`TOTAL: ${total}`);
  console.log(`\nExpected total: 858570120.92`);
  console.log(`Match: ${Math.abs(total - 858570120.92) < 1}`);

  await client.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
