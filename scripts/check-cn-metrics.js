require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  console.log("=== GAME STATE ===");
  const gs = await db.collection("gameState").findOne({ _id: "current" });
  console.log("Current Year:", gs?.currentYear);
  console.log("Starting Year:", gs?.startingYear);
  console.log("Current Turn:", gs?.currentTurn);
  console.log("Preset:", gs?.preset || "NOT SET");
  console.log("");

  console.log("=== CN FEDERAL BUDGET ===");
  const cnBudget = await db.collection("federalBudget").findOne({ _id: "CN" });
  if (cnBudget) {
    console.log("GDP:", cnBudget.gdp?.toLocaleString());
    console.log("Population:", cnBudget.population?.toLocaleString());
    console.log("Fiscal Year:", cnBudget.fiscalYear);
    console.log("Currency:", cnBudget.currencyCode);
    console.log("Economic Factors:", JSON.stringify(cnBudget.economicFactors));
    console.log("Tax Rates:", JSON.stringify(cnBudget.taxRates));
    console.log("Revenue Total:", cnBudget.revenue?.total?.toLocaleString());
    console.log("Spending Total:", cnBudget.spending?.total?.toLocaleString());
    console.log("Surplus:", cnBudget.surplus?.toLocaleString());
  }
  console.log("");

  console.log("=== CN STATE METRICS (sample) ===");
  const cnStates = await db
    .collection("stateMetrics")
    .find({ _id: { $regex: "^CN-" } })
    .limit(3)
    .toArray();
  cnStates.forEach((s) => {
    console.log(s._id + ": population=" + s.population + ", gdp=" + s.gdp);
  });
  console.log("");

  console.log("=== CN STATES ===");
  const states = await db.collection("states").find({ countryId: "CN" }).toArray();
  states.forEach((s) => {
    console.log(s._id + ": name=" + s.name + ", pop=" + s.population + ", gdp=" + s.gdp);
  });

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
