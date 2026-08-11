require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  console.log("=== ALL stateMetrics IDs ===");
  const all = await db.collection("stateMetrics").find({}, { _id: 1 }).toArray();
  all.forEach((d) => console.log("  " + d._id));
  console.log("Total:", all.length);
  console.log("");

  console.log("=== stateMetrics with DB, HB, HD, etc. ===");
  const cnLike = await db
    .collection("stateMetrics")
    .find({ _id: { $in: ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"] } })
    .toArray();
  cnLike.forEach((m) => {
    console.log("ID:", m._id, "| countryId:", m.countryId);
  });
  console.log("");

  console.log("=== stateMetrics with CN- prefix ===");
  const cnPrefixed = await db
    .collection("stateMetrics")
    .find({ _id: { $regex: "^CN" } })
    .toArray();
  cnPrefixed.forEach((m) => {
    console.log("ID:", m._id, "| countryId:", m.countryId);
  });

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
