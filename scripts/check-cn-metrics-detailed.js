require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  console.log("=== CN STATE METRICS (all 7 regions) ===");
  const cnMetrics = await db
    .collection("stateMetrics")
    .find({ _id: { $in: ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"] } })
    .toArray();

  cnMetrics.forEach((m) => {
    console.log("\n--- " + m._id + " ---");
    console.log("countryId:", m.countryId);

    if (m.economic) {
      console.log("Economic:");
      Object.entries(m.economic).forEach(([k, v]) => {
        const val = typeof v === "object" && v !== null ? v.value : v;
        console.log("  " + k + ": " + val);
      });
    }

    if (m.governance) {
      console.log("Governance:");
      Object.entries(m.governance).forEach(([k, v]) => {
        const val = typeof v === "object" && v !== null ? v.value : v;
        console.log("  " + k + ": " + val);
      });
    }

    if (m.population) {
      console.log("Population:");
      Object.entries(m.population).forEach(([k, v]) => {
        const val = typeof v === "object" && v !== null ? v.value : v;
        console.log("  " + k + ": " + val);
      });
    }

    if (m.social) {
      console.log("Social:");
      Object.entries(m.social).forEach(([k, v]) => {
        const val = typeof v === "object" && v !== null ? v.value : v;
        console.log("  " + k + ": " + val);
      });
    }
  });

  console.log("\n=== CN NATIONAL METRICS ===");
  const cnNational = await db.collection("stateMetrics").findOne({ _id: "cn_national" });
  if (cnNational) {
    console.log("ID:", cnNational._id);
    console.log("countryId:", cnNational.countryId);

    if (cnNational.economic) {
      console.log("Economic:");
      Object.entries(cnNational.economic).forEach(([k, v]) => {
        const val = typeof v === "object" && v !== null ? v.value : v;
        console.log("  " + k + ": " + val);
      });
    }

    if (cnNational.governance) {
      console.log("Governance:");
      Object.entries(cnNational.governance).forEach(([k, v]) => {
        const val = typeof v === "object" && v !== null ? v.value : v;
        console.log("  " + k + ": " + val);
      });
    }
  }

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
