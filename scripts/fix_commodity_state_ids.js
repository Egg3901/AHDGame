/**
 * Fix stale state ID keys in commodityPrices collection.
 *
 * After the DE region rename (HB → BRE) and CN/IE region remaps, the
 * commodityPrices docs still have supply/demand/price data under the old
 * "HB" key (DE Bremen) while the new "BRE" key has zero values. The new
 * "HB" key now belongs to CN Hebei — but until the next turn runs, it
 * contains DE Bremen's data.
 *
 * This script copies the DE Bremen data from HB → BRE in all commodityPrices
 * docs, so that the commodity drilldown pages work correctly until the turn
 * processor recalculates everything from stateResourceCapacity.
 *
 * Usage: node scripts/fix_commodity_state_ids.js
 */

require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

async function migrate() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  const docs = await db.collection("commodityPrices").find({}).toArray();
  let migrated = 0;

  for (const doc of docs) {
    const updates = {};

    // DE Bremen: copy HB → BRE when BRE is 0 or missing
    for (const field of ["stateSupply", "stateDemand", "statePrices"]) {
      if (doc[field]) {
        const hbVal = doc[field]["HB"];
        const breVal = doc[field]["BRE"];
        if (hbVal !== undefined && (breVal === undefined || breVal === 0)) {
          updates[`${field}.BRE`] = hbVal;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.collection("commodityPrices").updateOne({ _id: doc._id }, { $set: updates });
      migrated++;
    }
  }

  console.log(`Migrated ${migrated} commodity price docs (DE HB -> BRE)`);
  await client.close();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
