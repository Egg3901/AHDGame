require("dotenv").config({ path: "./.env.local" });
const { MongoClient } = require("mongodb");
const fs = require("fs");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  // Current commodity price for energy
  const current = await db.collection("commodityPrices").findOne({ commodity: "energy" });
  console.log("=== CURRENT energy commodity ===");
  console.log(`globalSupply: ${current.globalSupply}`);
  console.log(`globalDemand: ${current.globalDemand}`);
  console.log(`globalPrice: ${current.globalPrice}`);
  console.log(`basePrice: ${current.basePrice}`);
  console.log(`nationalSupply: ${JSON.stringify(current.nationalSupply)}`);
  console.log(`nationalDemand: ${JSON.stringify(current.nationalDemand)}`);

  // Read backup commodity prices
  const backupFile =
    "/root/a-house-divided-backups/2026-06-21_04-53/a-house-divided/commodityPrices.bson";
  const bson = require("bson");
  const bsonData = fs.readFileSync(backupFile);
  let offset = 0;
  while (offset < bsonData.length) {
    const size = bsonData.readInt32LE(offset);
    if (size <= 0 || offset + size > bsonData.length) break;
    const doc = bson.deserialize(bsonData.subarray(offset, offset + size), {
      promoteBuffers: false,
      promoteValues: true,
    });
    if (doc.commodity === "energy") {
      console.log("\n=== BACKUP (June 21 04:53) energy commodity ===");
      console.log(`globalSupply: ${doc.globalSupply}`);
      console.log(`globalDemand: ${doc.globalDemand}`);
      console.log(`globalPrice: ${doc.globalPrice}`);
      console.log(`basePrice: ${doc.basePrice}`);
      console.log(`nationalSupply: ${JSON.stringify(doc.nationalSupply)}`);
      console.log(`nationalDemand: ${JSON.stringify(doc.nationalDemand)}`);

      console.log("\n=== DELTA ===");
      console.log(
        `globalSupply: ${current.globalSupply} → ${doc.globalSupply} (delta: ${doc.globalSupply - current.globalSupply})`
      );
      console.log(`globalPrice: ${current.globalPrice} → ${doc.globalPrice}`);
      break;
    }
    offset += size;
  }

  await client.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
