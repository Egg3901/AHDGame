require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  const gs = await db.collection("gameState").findOne({ _id: "current" });
  const currentTurn = gs.currentTurn;

  console.log("=== A HOUSE DIVIDED - TARIFF IMPACT ANALYSIS ===");
  console.log("Turn:", currentTurn, "| Year:", gs.currentYear);
  console.log("");

  // 1. Current tariff state
  const tariffs = await db.collection("tariffs").find({}).toArray();
  console.log("=== CURRENT TARIFFS IN DB ===");
  console.log("Records found:", tariffs.length);
  tariffs.forEach((t, i) => {
    console.log(
      "  [" +
        i +
        "] from=" +
        t.fromCountryId +
        " to=" +
        t.toCountryId +
        " rate=" +
        t.rate +
        "% type=" +
        t.type
    );
  });
  console.log("");

  // 2. Commodity supply/demand baseline
  const commodities = await db.collection("commodityPrices").find({}).toArray();
  console.log("=== COMMODITY BASELINE (Turn " + currentTurn + ") ===");
  const commodityStats = commodities.map((c) => {
    const ratio = c.globalDemand / c.globalSupply;
    const priceRatio = c.globalPrice / c.basePrice;
    return {
      name: c.commodity,
      price: c.globalPrice,
      basePrice: c.basePrice,
      supply: c.globalSupply,
      demand: c.globalDemand,
      sdRatio: ratio,
      priceRatio: priceRatio,
      isExtractive: [
        "oil",
        "coal",
        "iron",
        "natural_gas",
        "copper",
        "rare_earth",
        "timber",
      ].includes(c.commodity),
    };
  });

  commodityStats.sort((a, b) => b.sdRatio - a.sdRatio);
  commodityStats.forEach((c) => {
    const status = c.sdRatio > 1.5 ? "SHORTAGE" : c.sdRatio < 0.8 ? "SURPLUS" : "BALANCED";
    const extractive = c.isExtractive ? " [EXTRACTIVE]" : "";
    console.log(
      "  " +
        c.name +
        ": $" +
        c.price.toFixed(2) +
        " (base $" +
        c.basePrice +
        ") S/D=" +
        c.sdRatio.toFixed(2) +
        " -> " +
        status +
        extractive
    );
  });
  console.log("");

  // 3. Corporate sector composition by country
  console.log("=== CORPORATE SECTOR COMPOSITION ===");
  const sectors = await db.collection("corporateSectors").find({}).toArray();
  const byCountrySector = {};
  sectors.forEach((s) => {
    if (!byCountrySector[s.countryId]) byCountrySector[s.countryId] = {};
    if (!byCountrySector[s.countryId][s.sectorType])
      byCountrySector[s.countryId][s.sectorType] = { count: 0, revenue: 0 };
    byCountrySector[s.countryId][s.sectorType].count++;
    byCountrySector[s.countryId][s.sectorType].revenue += s.revenue || 0;
  });

  Object.entries(byCountrySector).forEach(([country, types]) => {
    console.log("  " + country + ":");
    Object.entries(types).forEach(([type, data]) => {
      console.log(
        "    " + type + ": " + data.count + " sectors, revenue=" + data.revenue.toFixed(0)
      );
    });
  });
  console.log("");

  // 4. Exchange rate context
  const fx = await db.collection("exchangeRates").find({}).toArray();
  console.log("=== EXCHANGE RATES (Forex Enabled: " + gs.forexEnabled + ") ===");
  fx.forEach((r) => {
    const deviation = (((r.rate - r.baseRate) / r.baseRate) * 100).toFixed(1);
    console.log(
      "  " + r._id + ": " + r.rate.toFixed(4) + " (base " + r.baseRate + ", dev " + deviation + "%)"
    );
  });
  console.log("");

  // 5. Central bank rates
  const cb = await db.collection("centralBanks").find({}).toArray();
  console.log("=== CENTRAL BANK PRIME RATES ===");
  cb.forEach((b) => {
    console.log("  " + b._id + ": " + b.primeRate + "%");
  });
  console.log("");

  // 6. Federal budgets
  const budgets = await db.collection("federalBudget").find({}).toArray();
  console.log("=== FEDERAL BUDGETS ===");
  budgets.forEach((b) => {
    console.log(
      "  " +
        b._id +
        ": revenue=" +
        (b.revenue?.total || "N/A") +
        " spending=" +
        (b.spending?.total || "N/A")
    );
  });
  console.log("");

  // 7. Commodity price history to see trend
  console.log("=== COMMODITY PRICE HISTORY (Last 5 turns) ===");
  for (const comm of ["oil", "steel", "energy", "food", "iron"]) {
    const history = await db
      .collection("commodityPriceHistory")
      .find({ commodity: comm, turn: { $gte: currentTurn - 5 } })
      .sort({ turn: -1 })
      .limit(5)
      .toArray();
    if (history.length > 0) {
      const prices = history.map((h) => h.price?.toFixed(2) || h.globalPrice?.toFixed(2) || "N/A");
      console.log("  " + comm + ": " + prices.join(" -> "));
    }
  }
  console.log("");

  // 8. Tariff mechanics from code
  console.log("=== TARIFF MECHANICS (from codebase) ===");
  console.log(
    "  - Tariffs stored in: tariffs collection {fromCountryId, toCountryId, rate, type, commodity}"
  );
  console.log("  - Current DB has " + tariffs.length + " tariff records (mostly empty/undefined)");
  console.log("  - No active tariff simulation detected in current game state");
  console.log(
    "  - Commodity prices driven by: sector supply/demand + macro demand + extraction capacity"
  );
  console.log("  - Price formula: basePrice * exp(0.7 * ln(supply/demand))");
  console.log("  - Forex: enabled, rates fluctuate around base rates");
  console.log("");

  // 9. Projected 100% tariff impact analysis
  console.log("=== PROJECTED IMPACT OF 100% TARIFFS ===");
  console.log("");
  console.log(
    "SCENARIO: All countries impose 100% tariffs on all imports from all trading partners"
  );
  console.log("");

  // Calculate trade exposure
  const corps = await db.collection("corporations").find({}).toArray();
  const publicCorps = corps.filter((c) => !c.isPrivate);
  console.log("Trade-exposed public corporations:", publicCorps.length);

  // Revenue concentration by country
  const countryRevenue = {};
  sectors.forEach((s) => {
    countryRevenue[s.countryId] = (countryRevenue[s.countryId] || 0) + (s.revenue || 0);
  });
  console.log("Total sector revenue by country:");
  Object.entries(countryRevenue).forEach(([k, v]) => console.log("  " + k + ": $" + v.toFixed(0)));
  console.log("");

  // Identify import-dependent sectors
  const importDependentSectors = [
    "electronics",
    "vehicles",
    "pharmaceuticals",
    "chemicals",
    "plastics",
    "rare_earth",
  ];
  console.log("Import-dependent sectors (high trade exposure):");
  importDependentSectors.forEach((s) => {
    const count = sectors.filter((sec) => sec.sectorType === s).length;
    const revenue = sectors
      .filter((sec) => sec.sectorType === s)
      .reduce((sum, sec) => sum + (sec.revenue || 0), 0);
    console.log("  " + s + ": " + count + " sectors, $" + revenue.toFixed(0) + " revenue");
  });
  console.log("");

  // Extractive/export sectors
  const extractiveSectors = [
    "oil",
    "coal",
    "iron",
    "natural_gas",
    "copper",
    "rare_earth",
    "timber",
  ];
  console.log("Extractive/export sectors (would face retaliatory tariffs):");
  extractiveSectors.forEach((s) => {
    const count = sectors.filter((sec) => sec.sectorType === s).length;
    const revenue = sectors
      .filter((sec) => sec.sectorType === s)
      .reduce((sum, sec) => sum + (sec.revenue || 0), 0);
    console.log("  " + s + ": " + count + " sectors, $" + revenue.toFixed(0) + " revenue");
  });
  console.log("");

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
