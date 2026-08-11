/**
 * Diagnostic script: check for stale commodity and forex data that survived
 * a game reset. Run this after a reset to verify the data is clean.
 *
 * Usage: npx tsx scripts/check-stale-commodity-forex.ts
 *
 * For manual cleanup (run AFTER diagnostics):
 *   npx tsx scripts/check-stale-commodity-forex.ts --clean
 */
import { connectDb, closeDb } from "./utils/db";

const CLEAN = process.argv.includes("--clean");

async function main() {
  const db = await connectDb();

  console.log("=== commodityPrices (should be base prices at turn 0 or empty) ===");
  const cpCount = await db.collection("commodityPrices").countDocuments();
  console.log(`  count: ${cpCount}`);
  if (cpCount > 0) {
    const samples = await db
      .collection("commodityPrices")
      .find({})
      .sort({ commodity: 1 })
      .limit(5)
      .toArray();
    for (const d of samples) {
      const stale =
        d.turn !== 0 || d.globalSupply !== 0 || d.globalDemand !== 0 ? " ⚠️ STALE" : " ✓ fresh";
      console.log(
        `  ${d.commodity}: base=${d.basePrice} global=${d.globalPrice} supply=${d.globalSupply} demand=${d.globalDemand} turn=${d.turn}${stale}`
      );
    }
  }

  console.log("\n=== commodityPriceHistory (should be empty after reset) ===");
  const cphCount = await db.collection("commodityPriceHistory").countDocuments();
  console.log(
    `  count: ${cphCount}${cphCount > 0 ? " ⚠️ STALE — leftover history from previous game" : " ✓ empty"}`
  );

  console.log("\n=== commodityPrice (legacy singular — should not exist) ===");
  const cpLegacy = await db.collection("commodityPrice").countDocuments();
  console.log(`  count: ${cpLegacy}${cpLegacy > 0 ? " ⚠️ legacy rows present" : " ✓ empty"}`);

  console.log("\n=== exchangeRates (should be at INITIAL_RATES, turn 0) ===");
  const erCount = await db.collection("exchangeRates").countDocuments();
  console.log(`  count: ${erCount}`);
  if (erCount > 0) {
    const rates = await db.collection("exchangeRates").find({}).sort({ _id: 1 }).toArray();
    for (const d of rates) {
      const rateDrift =
        d.rate !== d.baseRate
          ? ` ⚠️ STALE (rate=${d.rate} != baseRate=${d.baseRate})`
          : " ✓ at base rate";
      const histLen = (d.rateHistory || []).length;
      const histNote = histLen > 0 ? ` ⚠️ ${histLen} history entries` : "";
      console.log(
        `  ${d._id}: rate=${d.rate} baseRate=${d.baseRate} macroTarget=${d.macroTarget}${rateDrift}${histNote}`
      );
    }
  }

  console.log("\n=== centralBanks (should have forexRevenue=0, empty histories) ===");
  const cbCount = await db.collection("centralBanks").countDocuments();
  console.log(`  count: ${cbCount}`);
  if (cbCount > 0) {
    const banks = await db.collection("centralBanks").find({}).sort({ _id: 1 }).toArray();
    for (const d of banks) {
      const issues: string[] = [];
      if (d.forexRevenue && d.forexRevenue !== 0) issues.push(`forexRevenue=${d.forexRevenue}`);
      if ((d.rateHistory || []).length > 0) issues.push(`${d.rateHistory.length} rate entries`);
      if ((d.interestRateHistory || []).length > 0)
        issues.push(`${d.interestRateHistory.length} interest entries`);
      if ((d.inflationHistory || []).length > 0)
        issues.push(`${d.inflationHistory.length} inflation entries`);
      if ((d.gdpGrowthHistory || []).length > 0)
        issues.push(`${d.gdpGrowthHistory.length} gdpGrowth entries`);
      if (d.chairCharacterId) issues.push(`chair assigned`);
      const status = issues.length > 0 ? ` ⚠️ ${issues.join(", ")}` : " ✓ clean";
      console.log(`  ${d._id}: primeRate=${d.primeRate}${status}`);
    }
  }

  console.log("\n=== currencyOrders (should be empty after reset) ===");
  const coCount = await db.collection("currencyOrders").countDocuments();
  console.log(
    `  count: ${coCount}${coCount > 0 ? " ⚠️ STALE — pending orders from previous game" : " ✓ empty"}`
  );

  console.log("\n=== tradeHistory (should be empty after reset) ===");
  const thCount = await db.collection("tradeHistory").countDocuments();
  console.log(
    `  count: ${thCount}${thCount > 0 ? " ⚠️ STALE — trade history from previous game" : " ✓ empty"}`
  );

  console.log("\n=== gameState forex ===");
  const gameStateCol = db.collection("gameState");

  const gs = (await gameStateCol.findOne({ _id: "current" } as any)) as any;
  if (gs) {
    console.log(
      `  turn: ${gs.currentTurn} | year: ${gs.currentYear} | preset: ${gs.preset} | forexEnabled: ${gs.forexEnabled}`
    );
  } else {
    console.log("  ⚠️ No gameState document found");
  }

  if (CLEAN) {
    console.log("\n=== CLEANING STALE DATA ===");
    const results = {
      commodityPriceHistory: await db.collection("commodityPriceHistory").deleteMany({}),
      commodityPrice: await db.collection("commodityPrice").deleteMany({}),
      commodityPrices: await db.collection("commodityPrices").deleteMany({}),
      exchangeRates: await db.collection("exchangeRates").deleteMany({}),
      centralBanks: await db.collection("centralBanks").deleteMany({}),
      currencyOrders: await db.collection("currencyOrders").deleteMany({}),
      tradeHistory: await db.collection("tradeHistory").deleteMany({}),
    };
    for (const [coll, res] of Object.entries(results)) {
      console.log(`  ${coll}: deleted ${res.deletedCount}`);
    }
    console.log("\n⚠️  Run `npm run seed` or the bootstrap to re-seed baseline data,");
    console.log("    then run `POST /api/admin/forex/enable` to re-enable forex.");
    console.log("    Or simply run `npm run reset-and-bootstrap` for a full fresh start.");
  }

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
