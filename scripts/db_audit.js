const { MongoClient } = require("mongodb");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }

  const client = new MongoClient(uri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 30000,
  });

  try {
    await client.connect();
    const db = client.db("a-house-divided");

    const collections = await db.listCollections().toArray();
    console.log("=== COLLECTIONS ===");
    for (const c of collections.sort((a, b) => a.name.localeCompare(b.name))) {
      const count = await db.collection(c.name).countDocuments();
      console.log(c.name + ": " + count + " docs");
    }

    console.log("\n=== COUNTRIES IN KEY COLLECTIONS ===");
    const stateCountries = await db.collection("states").distinct("countryId");
    console.log("states: " + JSON.stringify(stateCountries));
    const charCountries = await db.collection("characters").distinct("countryId");
    console.log("characters: " + JSON.stringify(charCountries));
    const cgs = await db.collection("countryGameStates").find({}).toArray();
    console.log(
      "countryGameStates: " +
        JSON.stringify(cgs.map((x) => ({ _id: x._id, turn: x.currentTurn, year: x.currentYear })))
    );
    const banks = await db.collection("centralBanks").find({}).toArray();
    console.log(
      "centralBanks: " + JSON.stringify(banks.map((x) => ({ _id: x._id, rate: x.primeRate })))
    );
    const budgets = await db.collection("nationalBudgets").find({}).toArray();
    console.log(
      "nationalBudgets: " +
        JSON.stringify(
          budgets.map((x) => ({
            _id: x._id,
            countryId: x.countryId,
            fy: x.fiscalYear,
            rev: x.revenue?.total,
            spend: x.spending?.total,
          }))
        )
    );

    const billCountries = await db.collection("bills").distinct("countryId");
    console.log("bills: " + JSON.stringify(billCountries));
    const tariffCountries = await db.collection("tariffs").distinct("countryId");
    console.log("tariffs: " + JSON.stringify(tariffCountries));
    const corpCountries = await db.collection("corporations").distinct("countryId");
    console.log("corporations HQ: " + JSON.stringify(corpCountries));
    const partyCountries = await db.collection("politicalParties").distinct("countryId");
    console.log("politicalParties: " + JSON.stringify(partyCountries));
    const rates = await db.collection("exchangeRates").find({}).toArray();
    console.log(
      "exchangeRates: " + JSON.stringify(rates.map((x) => ({ _id: x._id, rate: x.rate })))
    );

    console.log("\n=== STATE METRICS SAMPLES ===");
    for (const cid of ["US", "UK", "DE", "JP"]) {
      const m = await db.collection("stateMetrics").findOne({ countryId: cid });
      if (m) {
        console.log(cid + " (countryId): _id=" + m._id);
      } else {
        const alt = await db
          .collection("stateMetrics")
          .findOne({ _id: new RegExp("^" + cid + "[_-]") });
        console.log(cid + ": " + (alt ? "found _id=" + alt._id : "NO METRICS"));
      }
    }

    console.log("\n=== MACRO/SNAPSHOT COLLECTIONS ===");
    const macroCols = collections.filter(
      (c) =>
        c.name.includes("history") ||
        c.name.includes("snapshot") ||
        c.name.includes("macro") ||
        c.name.includes("price") ||
        c.name.includes("turnLog")
    );
    for (const c of macroCols) {
      const count = await db.collection(c.name).countDocuments();
      const sample = await db.collection(c.name).findOne({});
      console.log(
        c.name +
          ": " +
          count +
          " docs, keys=" +
          (sample ? Object.keys(sample).slice(0, 6).join(",") : "empty")
      );
    }

    const gs = await db.collection("gameState").findOne({ _id: "current" });
    console.log(
      "\ngameState current: " +
        JSON.stringify(gs ? { turn: gs.currentTurn, year: gs.currentYear } : "not found")
    );
  } catch (err) {
    console.error("ERROR:", err.message);
  } finally {
    await client.close();
  }
}
main();
