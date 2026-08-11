/**
 * Right-size UK NatCorp energy & defense sectors.
 *
 * Problem: The Energy Nationalisation Bill (turn 407) and Defence Industry
 * Nationalisation Act (turn 477) absorbed all private UK energy/defense sectors
 * into the UK primary NatCorp. The auto-seeder then boosted these sectors every
 * year via boostProtectedUnownedToNatCorp, with the 2.53x UK unowned multiplier
 * and an FX double-conversion bug inflating revenue. Result: UK natcorp energy
 * sectors grew from ~£432M to ~£1.36B, producing 70% of global energy.
 *
 * Fix: Reset each UK natcorp energy/defense sector to a GDP-proportional share
 * of the pre-nationalization total market revenue, using the nationalization bill
 * snapshots as the baseline. This preserves the monopoly market share that the
 * nationalization created while removing the auto-seed inflation.
 *
 * Baseline sources:
 *   Energy: bill 6a301a501165b5fb15e78174 snapshot — totalCompensationLocal £432M,
 *           unownedSliceRevenuePerTurn £16.4M/turn. Pre-nationalization the market
 *           was £432M comp (roughly = total sector revenue × some multiplier).
 *           The actual sector revenues summed to the compensation amount.
 *   Defense: bill 6a33ec6545d397d74019ad62 snapshot — totalCompensationLocal £833M.
 *
 * Approach: Distribute the pre-nationalization total sector revenue across the
 * 12 UK states proportional to GDP. This gives each natcorp sector a revenue
 * that reflects the state's share of the national energy/defense market.
 *
 * Usage:
 *   cd /root/projects/a-house-divided && node scripts/rightsize-uk-natcorp.js          # dry run
 *   cd /root/projects/a-house-divided && node scripts/rightsize-uk-natcorp.js --apply   # execute
 */
require("dotenv").config({ path: "./.env.local" });
const { MongoClient, ObjectId } = require("mongodb");

const UK_NATCORP_ID = new ObjectId("700000000000000000000001");

// Post-multiplier-removal, the unowned seed formula (gdp × 450 × weight) gives
// the per-state market size for one sector type. The natcorp as a 100% monopoly
// should hold roughly 3x the unowned baseline — the unowned pool represents the
// "free market" share, and the nationalized monopoly absorbed all private holders
// (8 energy corps, 3 defense corps). A 3x multiplier approximates the monopoly
// share without the 2.53x country multiplier + 1.25x global multiplier + FX bug
// that inflated the natcorp to £1.36B.
//
// Energy unowned pool (post-fix): ~₳1M/state × 12 states = ~₳12M → × 3 = ~₳36M
// In GBP: ₳36M × 0.6623 = ~£24M total (was £1.36B — 57x overinflated)
//
// Defense: same formula, redistribute current total by GDP (minimal change).
const MONOPOLY_MULTIPLIER = 3;
const SECTOR_SEED_SCALE = 450;
const MIN_UNOWNED_SECTOR_REVENUE = 1_000_000;
const DEFAULT_ENERGY_WEIGHT = 0.03;

async function run() {
  const apply = process.argv.includes("--apply");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  console.log(`=== UK NATCORP RIGHT-SIZING (${apply ? "APPLY" : "DRY RUN"}) ===\n`);

  // 1. Load UK states for GDP
  const ukStates = await db
    .collection("states")
    .find({ countryId: "UK" })
    .project({ _id: 1, name: 1, gdp: 1 })
    .toArray();
  const totalGdp = ukStates.reduce((sum, s) => sum + (s.gdp ?? 0), 0);
  console.log(`Total UK GDP: ${totalGdp.toLocaleString()}`);
  console.log(`UK states: ${ukStates.length}\n`);

  // 2. Get all UK natcorp energy & defense sectors
  const natcorpSectors = await db
    .collection("corporateSectors")
    .find({
      corporationId: UK_NATCORP_ID,
      sectorType: { $in: ["energy", "defense"] },
    })
    .toArray();

  console.log(`Found ${natcorpSectors.length} UK natcorp sectors to right-size\n`);

  // Compute defense baseline from current total (redistribute by GDP)
  const defenseSectors = natcorpSectors.filter((s) => s.sectorType === "defense");
  const defenseCurrentTotal = defenseSectors.reduce((sum, s) => sum + (s.revenue ?? 0), 0);

  // Load GBP FX rate for ₳ → GBP conversion
  const fxDoc = await db.collection("exchangeRates").findOne({ currencyCode: "GBP" });
  const gbpRate = fxDoc?.rate && fxDoc.rate > 0 ? fxDoc.rate : 1;
  console.log(`GBP FX rate: ${gbpRate}`);
  console.log(
    `Energy formula: max(${MIN_UNOWNED_SECTOR_REVENUE}, gdp × 1.0 × ${SECTOR_SEED_SCALE} × ${DEFAULT_ENERGY_WEIGHT}) × ${MONOPOLY_MULTIPLIER} × ${gbpRate} (₳→GBP)\n`
  );

  let totalOldRevenue = 0;
  let totalNewRevenue = 0;
  const updates = [];

  for (const sector of natcorpSectors) {
    const state = ukStates.find((s) => s._id === sector.stateId);
    const gdp = state?.gdp ?? 0;

    let newRevenue;
    if (sector.sectorType === "energy") {
      // Compute in ₳ using post-fix unowned formula, then apply monopoly multiplier
      const baseAnchor = Math.max(
        MIN_UNOWNED_SECTOR_REVENUE,
        Math.round(gdp * 1.0 * SECTOR_SEED_SCALE * DEFAULT_ENERGY_WEIGHT)
      );
      const monopolyAnchor = baseAnchor * MONOPOLY_MULTIPLIER;
      // Convert ₳ → GBP for storage (matches FX fix in seedToNatCorp.ts)
      newRevenue = Math.round(monopolyAnchor * gbpRate);
    } else {
      // Defense: redistribute current total by GDP share
      const gdpShare = totalGdp > 0 ? gdp / totalGdp : 0;
      newRevenue = Math.round(defenseCurrentTotal * gdpShare);
    }

    totalOldRevenue += sector.revenue;
    totalNewRevenue += newRevenue;

    const ratio = sector.revenue > 0 ? (newRevenue / sector.revenue).toFixed(3) : "N/A";
    const stateGdp = state?.gdp ?? 0;
    const gdpPct = totalGdp > 0 ? ((stateGdp / totalGdp) * 100).toFixed(1) : "0.0";
    console.log(
      `  ${sector.sectorType.padEnd(7)} ${sector.stateId.padEnd(4)}: ` +
        `£${sector.revenue?.toLocaleString().padStart(15)} → £${newRevenue.toLocaleString().padStart(15)} ` +
        `(×${ratio}, gdp=${gdpPct}%)`
    );

    updates.push({
      filter: { _id: sector._id },
      update: { $set: { revenue: newRevenue, updatedAt: new Date() } },
      sectorType: sector.sectorType,
      stateId: sector.stateId,
      oldRevenue: sector.revenue,
      newRevenue,
    });
  }

  console.log(`\n--- TOTALS ---`);
  console.log(`Old revenue: £${totalOldRevenue.toLocaleString()}`);
  console.log(`New revenue: £${totalNewRevenue.toLocaleString()}`);
  console.log(
    `Reduction:   £${(totalOldRevenue - totalNewRevenue).toLocaleString()} (${(((totalOldRevenue - totalNewRevenue) / totalOldRevenue) * 100).toFixed(1)}%)`
  );

  // 4. Estimate commodity impact
  // Energy supply units = revenueAnchor(₳) × 0.65 / 60
  // revenueAnchor = revenueGBP / gbpRate (gbpRate already loaded above)

  const energyUpdates = updates.filter((u) => u.sectorType === "energy");
  const newEnergyAnchor = energyUpdates.reduce((sum, u) => sum + u.newRevenue / gbpRate, 0);
  const oldEnergyAnchor = energyUpdates.reduce((sum, u) => sum + u.oldRevenue / gbpRate, 0);
  const newEnergyUnits = (newEnergyAnchor * 0.65) / 60;
  const oldEnergyUnits = (oldEnergyAnchor * 0.65) / 60;

  // Current global supply from commodityPrices
  const energyDoc = await db.collection("commodityPrices").findOne({ commodity: "energy" });
  const currentGlobalSupply = energyDoc?.globalSupply ?? 29_318_096;

  console.log(`\n--- ENERGY COMMODITY IMPACT ---`);
  console.log(
    `Old UK energy supply: ${oldEnergyUnits.toFixed(0)} units/turn (₳${oldEnergyAnchor.toFixed(0)})`
  );
  console.log(
    `New UK energy supply: ${newEnergyUnits.toFixed(0)} units/turn (₳${newEnergyAnchor.toFixed(0)})`
  );
  console.log(`Current global supply: ${currentGlobalSupply.toFixed(0)} units/turn`);
  console.log(`Old UK % of global: ${((oldEnergyUnits / currentGlobalSupply) * 100).toFixed(1)}%`);
  console.log(
    `New UK % of global: ${((newEnergyUnits / (currentGlobalSupply - oldEnergyUnits + newEnergyUnits)) * 100).toFixed(1)}% (adjusted)`
  );

  if (apply) {
    console.log(`\n=== APPLYING UPDATES ===`);
    let applied = 0;
    for (const u of updates) {
      const result = await db.collection("corporateSectors").updateOne(u.filter, u.update);
      if (result.modifiedCount > 0) applied++;
    }
    console.log(`Updated ${applied}/${updates.length} sectors`);

    // Also refresh UK unowned energy/defense sectors to match post-multiplier-removal formula
    // (so auto-seed doesn't re-boost with old inflated values)
    console.log(`\n=== REFRESHING UK UNOWNED ENERGY/DEFENSE SECTORS ===`);
    const SECTOR_SEED_SCALE = 450;
    const MIN_REV = 1_000_000;
    for (const sectorType of ["energy", "defense"]) {
      for (const state of ukStates) {
        // Default 3% weight for all UK states (post-multiplier-removal)
        const weight = 0.03;
        const newRev = Math.max(MIN_REV, Math.round(state.gdp * 1.0 * SECTOR_SEED_SCALE * weight));
        const result = await db
          .collection("unownedSectors")
          .updateOne(
            { stateId: state._id, sectorType },
            { $set: { revenue: newRev, updatedAt: new Date() } }
          );
        if (result.modifiedCount > 0) {
          console.log(`  ${sectorType} ${state._id}: → ₳${newRev.toLocaleString()}`);
        }
      }
    }
    console.log(`\nDone. Next commodity turn will recalculate global supply/demand.`);
  } else {
    console.log(`\n(Dry run — pass --apply to execute)`);
  }

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
