require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  // Check current game state
  const gs = await db.collection("gameState").findOne({ _id: "current" });
  console.log("=== GAME STATE ===");
  console.log("Current Turn:", gs?.currentTurn);
  console.log("Current Year:", gs?.currentYear);
  console.log("Forex Enabled:", gs?.forexEnabled);

  // Check tariffs collection
  const tariffs = await db.collection("tariffs").find({}).toArray();
  console.log("\n=== TARIFFS ===");
  console.log("Total tariff records:", tariffs.length);
  if (tariffs.length > 0) {
    tariffs.forEach((t) => {
      console.log(
        "  " +
          t.fromCountryId +
          " -> " +
          t.toCountryId +
          ": " +
          t.rate +
          "% (type: " +
          t.type +
          ", commodity: " +
          (t.commodity || "all") +
          ")"
      );
    });
  } else {
    console.log("  No tariffs in database");
  }

  // Check commodity prices
  const commodities = await db.collection("commodityPrices").find({}).toArray();
  console.log("\n=== COMMODITIES ===");
  console.log("Total commodities:", commodities.length);
  commodities.forEach((c) => {
    const ratio = c.globalDemand / c.globalSupply;
    console.log(
      "  " +
        c.commodity +
        ": price=" +
        c.globalPrice.toFixed(2) +
        " base=" +
        c.basePrice +
        " S=" +
        c.globalSupply.toFixed(0) +
        " D=" +
        c.globalDemand.toFixed(0) +
        " ratio=" +
        ratio.toFixed(2)
    );
  });

  // Check exchange rates
  const fx = await db.collection("exchangeRates").find({}).toArray();
  console.log("\n=== EXCHANGE RATES ===");
  fx.forEach((r) =>
    console.log("  " + r._id + ": rate=" + r.rate.toFixed(4) + " base=" + r.baseRate)
  );

  // Check central banks for prime rates
  const cb = await db.collection("centralBanks").find({}).toArray();
  console.log("\n=== CENTRAL BANK PRIME RATES ===");
  cb.forEach((b) => console.log("  " + b._id + ": primeRate=" + b.primeRate + "%"));

  // Check country state for economic data
  const countries = await db.collection("countryState").find({}).toArray();
  console.log("\n=== COUNTRIES ===");
  countries.forEach((c) => {
    console.log(
      "  " + c._id + ": govType=" + c.governmentType + ", rulingParty=" + c.rulingPartyId
    );
  });

  // Check corporations for trade-relevant data
  const corps = await db.collection("corporations").find({}).toArray();
  console.log("\n=== CORPORATIONS ===");
  console.log("Total corporations:", corps.length);

  // Count by country
  const byCountry = {};
  corps.forEach((c) => {
    byCountry[c.countryId] = (byCountry[c.countryId] || 0) + 1;
  });
  Object.entries(byCountry).forEach(([k, v]) => console.log("  " + k + ": " + v + " corps"));

  // Check for any trade-related collections
  const collections = await db.listCollections().toArray();
  console.log("\n=== ALL COLLECTIONS ===");
  collections.forEach((c) => console.log("  " + c.name));

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
