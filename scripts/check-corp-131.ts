import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db("a-house-divided");

  // Find corp with sequentialId=131
  const corp = await db.collection("corporations").findOne({ sequentialId: 131 });
  if (!corp) {
    console.log("No corp with sequentialId=131");
    // check some nearby
    for (const id of [130, 131, 132, 133]) {
      const c = await db
        .collection("corporations")
        .findOne({ sequentialId: id }, { projection: { name: 1, sequentialId: 1 } });
      if (c) console.log(`seq=${c.sequentialId}: ${c.name}`);
    }
    await client.close();
    return;
  }

  console.log("=== Corporation 131 ===");
  console.log("_id:", corp._id.toString());
  console.log("name:", corp.name);
  console.log("sequentialId:", corp.sequentialId);
  console.log("ceoId:", corp.ceoId?.toString());
  console.log("userId:", corp.userId?.toString());
  console.log("countryId:", corp.countryId);
  console.log("headquartersState:", corp.headquartersState);
  console.log("isPrivate:", corp.isPrivate);
  console.log("legalStructure:", corp.legalStructure);
  console.log("totalShares:", corp.totalShares);
  console.log("publicFloat:", corp.publicFloat);
  console.log("sharePrice:", corp.sharePrice);
  console.log("liquidCapital:", corp.liquidCapital);
  console.log("foundedAtTurn:", corp.foundedAtTurn);
  console.log("hiddenFromExchange:", corp.hiddenFromExchange);
  console.log("parentCorporation:", corp.parentCorporation);

  // Check the API route — resolveCorporation handles both ObjectId string and sequentialId
  // The frontend passes the _id as a string, so if someone navigates to /corporations/131
  // it would either be seq=131 or ObjectId hex. Let me check what the _id actually is
  console.log("\n_id hex:", corp._id.toString());

  // Now check if there's a problem with this corp's data
  const sectors = await db
    .collection("corporateSectors")
    .find({ corporationId: corp._id })
    .toArray();
  console.log("\nSectors:", sectors.length);
  sectors.forEach((s) =>
    console.log(
      `  ${s.sectorType} in ${s.stateId}: revenue=$${s.revenue}, profitMargin=${s.profitMargin}`
    )
  );

  // Check the user/character connected to this corp
  if (corp.userId) {
    const user = await db.collection("users").findOne({ _id: corp.userId });
    console.log("\nUser:", user?.username ?? "not found", "banned:", user?.isBanned);
  }
  if (corp.ceoId) {
    const ceo = await db.collection("characters").findOne({ _id: corp.ceoId });
    console.log("CEO:", ceo?.name ?? "not found");
  }

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
