require("dotenv").config({ path: "/root/projects/a-house-divided/.env.local" });
const { MongoClient, ObjectId } = require("mongodb");

async function run() {
  const baseUri = process.env.MONGODB_URI;
  const sep = baseUri.includes("?") ? "&" : "?";
  const client = new MongoClient(baseUri + sep + "directConnection=true");
  await client.connect();
  const db = client.db("a-house-divided");

  // 1. Current game config — what marketSystemMode is active?
  const config = await db.collection("gameConfig").findOne({});
  console.log("=== Game Config ===");
  console.log("marketSystemMode:", config?.marketSystemMode || "(not set)");
  console.log("current turn:", config?.currentTurn);

  // 2. Commodity prices for logistics-relevant commodities
  const relevantCommodities = [
    "freight",
    "consulting_services",
    "vehicles",
    "energy",
    "software",
    "electronics",
    "real_estate_services",
    "food",
  ];
  console.log("\n=== Commodity Prices (logistics-relevant) ===");
  const prices = await db
    .collection("commodityPrices")
    .find({ commodity: { $in: relevantCommodities } })
    .toArray();
  prices.forEach((p) => {
    const ratio = p.globalPrice && p.basePrice ? p.globalPrice / p.basePrice : null;
    const dsRatio = p.globalDemand && p.globalSupply ? p.globalDemand / p.globalSupply : null;
    console.log(
      `  ${p.commodity}: price=${p.globalPrice?.toFixed(2)} base=${p.basePrice?.toFixed(2)} ratio=${ratio?.toFixed(3)} demand=${p.globalDemand?.toFixed(0)} supply=${p.globalSupply?.toFixed(0)} ds=${dsRatio?.toFixed(3)}`
    );
  });

  // 3. How many logistics corps are there globally? (freight market saturation)
  console.log("\n=== Logistics Corps (freight market) ===");
  const logisticsCorps = await db
    .collection("corporations")
    .find({ type: "logistics" })
    .project({ _id: 1, name: 1, countryId: 1, isPrivate: 1 })
    .toArray();
  console.log(`Total logistics corps: ${logisticsCorps.length}`);
  logisticsCorps.forEach((c) => console.log(`  ${c.name} (${c.countryId}) private=${c.isPrivate}`));

  // 4. Total logistics sectors globally
  const logisticsSectors = await db
    .collection("corporateSectors")
    .find({ sectorType: "logistics" })
    .toArray();
  console.log(`\nTotal logistics sectors: ${logisticsSectors.length}`);
  const totalLogRev = logisticsSectors.reduce((s, sec) => s + sec.revenue, 0);
  console.log(`Total logistics sector revenue (base): ${totalLogRev.toFixed(0)}`);

  // 5. All corp sectors producing freight (any type that outputs freight)
  // Freight is also produced by: shipping/transport companies. Let's check who supplies it.
  // Check sector strategies to see who produces freight
  const freightSectors = await db.collection("corporateSectors").find({}).toArray();
  // We need to check the strategy supply rates — but those are in constants, not DB.
  // Instead, let's check total revenue by sector type to gauge market saturation
  console.log("\n=== Revenue by sector type (all countries) ===");
  const sectorTypeRev = {};
  for (const s of freightSectors) {
    if (!sectorTypeRev[s.sectorType]) sectorTypeRev[s.sectorType] = { count: 0, rev: 0 };
    sectorTypeRev[s.sectorType].count++;
    sectorTypeRev[s.sectorType].rev += s.revenue || 0;
  }
  Object.entries(sectorTypeRev)
    .sort((a, b) => b[1].rev - a[1].rev)
    .forEach(([type, data]) => {
      console.log(`  ${type}: ${data.count} sectors, $${data.rev.toFixed(0)} total revenue`);
    });

  // 6. UPS's sectors — check if clearingFactor/soldFraction/throughputFactor are already populated
  const upsId = new ObjectId("6a35c798815f5f23ef9c8747");
  const upsSectors = await db
    .collection("corporateSectors")
    .find({ corporationId: upsId })
    .toArray();
  console.log("\n=== UPS Sector Clearing State (if already computed) ===");
  upsSectors.slice(0, 5).forEach((s) => {
    console.log(
      `  ${s.stateId}/${s.sectorType} rev=${s.revenue?.toFixed(0)} strategy=${s.strategyId} posture=${s.pricingPosture} clearingFactor=${s.clearingFactor} soldFraction=${s.soldFraction} throughputFactor=${s.throughputFactor}`
    );
  });

  // 7. Check commodity prices for ALL commodities to find shortage/glut map
  console.log("\n=== Full Commodity Shortage/Glut Map ===");
  const allPrices = await db.collection("commodityPrices").find({}).toArray();
  const shortageMap = [];
  for (const p of allPrices) {
    if (!p.globalDemand || !p.globalSupply) continue;
    const ds = p.globalDemand / p.globalSupply;
    const pr = p.globalPrice && p.basePrice ? p.globalPrice / p.basePrice : null;
    shortageMap.push({
      commodity: p.commodity,
      ds,
      pr,
      demand: p.globalDemand,
      supply: p.globalSupply,
    });
  }
  shortageMap.sort((a, b) => b.ds - a.ds);
  console.log("--- TOP 15 SHORTAGES ---");
  shortageMap
    .slice(0, 15)
    .forEach((p) =>
      console.log(
        `  ${p.commodity}: ds=${p.ds.toFixed(2)} priceRatio=${p.pr?.toFixed(3)} demand=${p.demand.toFixed(0)} supply=${p.supply.toFixed(0)}`
      )
    );
  console.log("--- TOP 15 GLUTS ---");
  shortageMap
    .slice(-15)
    .reverse()
    .forEach((p) =>
      console.log(
        `  ${p.commodity}: ds=${p.ds.toFixed(2)} priceRatio=${p.pr?.toFixed(3)} demand=${p.demand.toFixed(0)} supply=${p.supply.toFixed(0)}`
      )
    );

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
