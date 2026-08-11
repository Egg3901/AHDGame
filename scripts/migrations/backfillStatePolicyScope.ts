/**
 * One-time migration: set statePolicies.scope for documents that are missing it.
 *
 * Background: prior to the billEnactment scope fix, onBillEnacted's upsert
 * omitted the `scope` field. For US/UK this was hidden by the baseline seed
 * (which set scope first), but for countries that weren't seeded before a bill
 * was enacted — notably JP on production — enacted StatePolicy docs have no
 * scope field, so /api/country/[code]/policy (which filters by
 * `{ scope: "national" }`) does not return them.
 *
 * The correct scope is derivable from the stateId: any value in NATIONAL_SCOPE
 * (federal, uk_national, jp_national, …) is national; everything else is
 * per-region state scope.
 *
 * Run: npx tsx scripts/migrations/backfillStatePolicyScope.ts
 * Requires MONGODB_URI in .env.local (point it at the target environment).
 */
import { connectDb, closeDb } from "../utils/db";
import { NATIONAL_SCOPE_IDS } from "../../src/lib/constants/nationalScope";

async function main() {
  const db = await connectDb();
  const statePolicies = db.collection("statePolicies");

  const nationalIds = [...NATIONAL_SCOPE_IDS];

  const nationalResult = await statePolicies.updateMany(
    { scope: { $exists: false }, stateId: { $in: nationalIds } },
    { $set: { scope: "national" } }
  );
  console.log(`Set scope="national" on ${nationalResult.modifiedCount} doc(s).`);

  const stateResult = await statePolicies.updateMany(
    { scope: { $exists: false }, stateId: { $nin: nationalIds } },
    { $set: { scope: "state" } }
  );
  console.log(`Set scope="state" on ${stateResult.modifiedCount} doc(s).`);

  const remaining = await statePolicies.countDocuments({ scope: { $exists: false } });
  if (remaining > 0) {
    console.warn(`WARNING: ${remaining} doc(s) still lack scope after backfill.`);
  } else {
    console.log("Done. Every statePolicies doc has a scope.");
  }

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
