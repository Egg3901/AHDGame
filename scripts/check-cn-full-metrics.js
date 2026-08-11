require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  // Check stateMetrics for CN
  const cnMetrics = await db
    .collection("stateMetrics")
    .find({ _id: { $regex: "^CN-" } })
    .toArray();
  console.log("=== CN STATE METRICS ===");
  console.log("Records found:", cnMetrics.length);
  cnMetrics.forEach((m) => {
    console.log("ID:", m._id);
    if (m.economic) {
      console.log("  Economic:", JSON.stringify(m.economic, null, 2));
    }
    if (m.demographic) {
      console.log("  Demographic:", JSON.stringify(m.demographic, null, 2));
    }
    if (m.political) {
      console.log("  Political:", JSON.stringify(m.political, null, 2));
    }
    console.log("");
  });

  // Check countryState for CN
  const cnState = await db.collection("countryState").findOne({ _id: "CN" });
  console.log("=== CN COUNTRY STATE ===");
  console.log(JSON.stringify(cnState, null, 2));

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
