import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db("a-house-divided");

  console.log("=== Elections by status ===");
  const statuses = await db
    .collection("elections")
    .aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
    .toArray();
  for (const s of statuses) console.log(`  ${s._id}: ${s.count}`);

  console.log("\n=== Elections by type ===");
  const types = await db
    .collection("elections")
    .aggregate([{ $group: { _id: "$electionType", count: { $sum: 1 } } }])
    .toArray();
  for (const t of types) console.log(`  ${t._id}: ${t.count}`);

  console.log("\n=== Elections by countryId ===");
  const countries = await db
    .collection("elections")
    .aggregate([{ $group: { _id: "$countryId", count: { $sum: 1 } } }])
    .toArray();
  for (const c of countries) console.log(`  ${c._id}: ${c.count}`);

  // Sample active elections to understand structure
  console.log("\n=== Sample active elections ===");
  const active = await db.collection("elections").find({ status: "active" }).limit(5).toArray();
  for (const e of active) {
    console.log(
      JSON.stringify({
        electionType: e.electionType,
        countryId: e.countryId,
        state: e.state,
        status: e.status,
        startTurn: e.startTurn,
        endTurn: e.endTurn,
        totalSeats: e.totalSeats,
        cycle: e.cycle,
      })
    );
  }

  await client.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
