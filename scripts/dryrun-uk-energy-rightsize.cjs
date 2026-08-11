#!/usr/bin/env node
/*
 * DRY-RUN ONLY — UK NatCorp energy right-size impact report.
 *
 * This script is strictly READ-ONLY. It issues only find/findOne/aggregate
 * calls. It contains NO updateOne / insertOne / deleteOne / bulkWrite paths,
 * so it cannot modify production data. It prints the projected before/after
 * for the one-time NatCorp energy reset that pairs with the code fix
 * (fix/uk-natcorp-energy-runaway: stop auto-seeding nationalized buckets).
 *
 * Target (matches scripts/rightsize-uk-natcorp.js, post-2.53x-removal):
 *   baseAnchor    = max(1,000,000, round(gdp × 450 × 0.03))      // ₳
 *   monopolyAnchor= baseAnchor × 3                                // 3x monopoly share
 *   newRevenueGBP = round(monopolyAnchor × gbpRate)               // stored in GBP
 *
 * Supply model (matches commodityPriceTurn.ts:340):
 *   anchor(₳) = revenueGBP / gbpRate ; energyUnits = anchor × 0.65 / 60
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const { MongoClient, ObjectId } = require("mongodb");

const UK_NATCORP_ID = new ObjectId("700000000000000000000001");
const SECTOR_SEED_SCALE = 450;
const ENERGY_WEIGHT = 0.03;
const MIN_UNOWNED_SECTOR_REVENUE = 1_000_000;
const MONOPOLY_MULTIPLIER = 3;
const ENERGY_SUPPLY_COEFF = 0.65; // representative energy-sector supply coefficient
const ENERGY_BASE_PRICE = 60;

const fmt = (n) => Math.round(n).toLocaleString();

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db();

  const fxDoc = await db.collection("exchangeRates").findOne({ currencyCode: "GBP" });
  const gbpRate = fxDoc?.rate && fxDoc.rate > 0 ? fxDoc.rate : 1;

  const ukStates = await db
    .collection("states")
    .find({ countryId: "UK" })
    .project({ _id: 1, name: 1, gdp: 1 })
    .toArray();
  const gdpOf = Object.fromEntries(ukStates.map((s) => [s._id, s.gdp ?? 0]));

  const energySectors = await db
    .collection("corporateSectors")
    .find({ corporationId: UK_NATCORP_ID, sectorType: "energy" })
    .toArray();

  const energyDoc = await db.collection("commodityPrices").findOne({ commodity: "energy" });
  const globalSupply = energyDoc?.globalSupply ?? 0;
  const ukActualSupply = energyDoc?.nationalSupply?.UK ?? 0;

  const rows = [];
  let oldRevTotal = 0,
    newRevTotal = 0;
  for (const s of energySectors) {
    const gdp = gdpOf[s.stateId] ?? 0;
    const baseAnchor = Math.max(
      MIN_UNOWNED_SECTOR_REVENUE,
      Math.round(gdp * SECTOR_SEED_SCALE * ENERGY_WEIGHT)
    );
    const newRev = Math.round(baseAnchor * MONOPOLY_MULTIPLIER * gbpRate);
    const oldRev = Math.round(s.revenue ?? 0);
    oldRevTotal += oldRev;
    newRevTotal += newRev;
    rows.push({
      state: s.stateId,
      oldGBP: oldRev,
      newGBP: newRev,
      factor: +(newRev / (oldRev || 1)).toFixed(3),
    });
  }
  rows.sort((a, b) => b.oldGBP - a.oldGBP);

  const toUnits = (gbp) => ((gbp / gbpRate) * ENERGY_SUPPLY_COEFF) / ENERGY_BASE_PRICE;
  const oldUKunits = energySectors.reduce((t, s) => t + toUnits(Math.round(s.revenue ?? 0)), 0);
  const newUKunits = newRevTotal === 0 ? 0 : rows.reduce((t, r) => t + toUnits(r.newGBP), 0);
  const newGlobal = globalSupply - oldUKunits + newUKunits;

  console.log("==================================================================");
  console.log(" UK NATCORP ENERGY RIGHT-SIZE — DRY RUN (no writes performed)");
  console.log("==================================================================");
  console.log(`GBP FX rate: ${gbpRate}   | energy turn: ${energyDoc?.turn}`);
  console.log(`\nPer-state NatCorp energy revenue (GBP):`);
  console.table(
    rows.map((r) => ({
      state: r.state,
      "old £": fmt(r.oldGBP),
      "new £": fmt(r.newGBP),
      "×": r.factor,
    }))
  );

  console.log(`--- REVENUE TOTALS ---`);
  console.log(
    `Old: £${fmt(oldRevTotal)}   New: £${fmt(newRevTotal)}   Reduction: £${fmt(oldRevTotal - newRevTotal)} (${(((oldRevTotal - newRevTotal) / (oldRevTotal || 1)) * 100).toFixed(1)}%)`
  );

  console.log(`\n--- ENERGY SUPPLY IMPACT (units/turn) ---`);
  console.log(
    `Model check — estimated old UK natcorp supply: ${fmt(oldUKunits)}  vs  DB nationalSupply.UK: ${fmt(ukActualSupply)}`
  );
  console.log(`Current global energy supply: ${fmt(globalSupply)}`);
  console.log(
    `UK share BEFORE: ${((oldUKunits / (globalSupply || 1)) * 100).toFixed(1)}%  (of current global)`
  );
  console.log(`Projected UK supply AFTER: ${fmt(newUKunits)}`);
  console.log(`Projected global AFTER:    ${fmt(newGlobal)}`);
  console.log(`UK share AFTER (model):  ${((newUKunits / (newGlobal || 1)) * 100).toFixed(1)}%`);

  // More accurate: scale the AUTHORITATIVE nationalSupply.UK by the revenue factor
  // (supply is linear in revenue), against the authoritative globalSupply.
  const revFactor = oldRevTotal === 0 ? 0 : newRevTotal / oldRevTotal;
  const ukSupplyAuth = ukActualSupply * revFactor;
  const globalAuth = globalSupply - ukActualSupply + ukSupplyAuth;
  console.log(
    `\n--- Authoritative projection (scaling DB nationalSupply by revenue factor ${revFactor.toFixed(4)}) ---`
  );
  console.log(
    `UK share BEFORE: ${((ukActualSupply / (globalSupply || 1)) * 100).toFixed(1)}%  →  AFTER: ${((ukSupplyAuth / (globalAuth || 1)) * 100).toFixed(1)}%`
  );
  console.log(`(UK energy supply ${fmt(ukActualSupply)} → ${fmt(ukSupplyAuth)} units/turn)`);

  await client.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
