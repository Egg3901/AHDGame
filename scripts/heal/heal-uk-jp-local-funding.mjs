/**
 * Heal the formulaGrants-on-non-US bug for the UK and Japan.
 *
 * What this script does (idempotent — safe to re-run):
 *   1. Backfills `isGrant: true` on existing active enactedLaws for
 *      uk_local_government_funding and jp_local_allocation_tax so the next
 *      `refreshNationalBudgetRevenue` pass routes their cost into
 *      federalBudget.spending.stateGrants instead of byCategory.economic.
 *   2. Zeros out `revenue.federalGrants` on UK and JP stateBudget docs.
 *      Recomputes `revenue.total` and `surplus` to match.
 *   3. Zeros out `federalBudget.spending.stateGrants` on UK and JP federal
 *      budgets so the user no longer sees a stale £310B/¥XB Westminster /
 *      Local Allocation Tax line until the next fiscal-year close
 *      regenerates it from the (currently 0) enacted-grant cost.
 *
 * What this script does NOT do:
 *   - Touch UK federalBudget.debt.principal — investigation shows debt
 *     accrual was never inflated (processAnnualDebt reads pre-FY-update
 *     spending which never contained the phantom).
 *   - Re-emit historical FY snapshots — those stay wrong but read-only.
 *
 * Usage: node scripts/heal/heal-uk-jp-local-funding.mjs [--dry-run]
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env.local") });

const dryRun = process.argv.includes("--dry-run");
const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE not set");
  process.exit(1);
}

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-GB") : String(n));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

const GRANT_LEG_TYPE_IDS = ["uk_local_government_funding", "jp_local_allocation_tax"];
const COUNTRIES = [
  { id: "UK", budgetId: "UK" },
  { id: "JP", budgetId: "JP" },
];

const client = new MongoClient(uri);
await client.connect();
const db = client.db("a-house-divided");

console.log(dryRun ? "=== DRY RUN ===" : "=== APPLYING HEAL ===");

// ── 1. Backfill isGrant on active enactedLaws ────────────────────────────────
console.log("\n[1] Backfilling isGrant=true on active enactedLaws …");
const activeGrantLaws = await db
  .collection("enactedLaws")
  .find({
    legislationTypeId: { $in: GRANT_LEG_TYPE_IDS },
    repealedAt: { $exists: false },
    isGrant: { $ne: true },
  })
  .toArray();
console.log(`  Found ${activeGrantLaws.length} active law(s) needing isGrant flag:`);
for (const law of activeGrantLaws) {
  console.log(
    `    ${law.legislationTypeId} _id=${law._id} title="${law.title}" annualCostPerCapita=${law.annualCostPerCapita}`
  );
}
if (!dryRun && activeGrantLaws.length > 0) {
  const result = await db.collection("enactedLaws").updateMany(
    {
      legislationTypeId: { $in: GRANT_LEG_TYPE_IDS },
      repealedAt: { $exists: false },
      isGrant: { $ne: true },
    },
    { $set: { isGrant: true } }
  );
  console.log(`  Updated ${result.modifiedCount} law(s).`);
}

// ── 2. Zero out phantom federalGrants on stateBudgets for UK/JP ──────────────
//
// `revenue.federalGrants` is overwritten each FY close with that year's
// phantom — it currently holds the FY2033 figure. Zero it, recompute
// `revenue.total` and `surplus` accordingly.
//
// `balance` accumulates surplus across FYs, so it has been inflated by the
// sum of all years' phantoms. Reconstructing the exact pre-bug balance
// is unreliable (we don't know when each stateBudget was first created or
// which FYs actually wrote to it). We take the defensible cut: reset
// balance = newSurplus (i.e., this year's correct surplus). This loses any
// legitimate historical accumulation, but UK uses regionalBudget for
// regional fiscal accounting anyway, and JP gameplay reads regionalBudget
// for grant flows — so balance is mostly cosmetic. The alternative
// (subtract cumulative snapshot phantom) drives most balances negative.
console.log("\n[2] Zeroing phantom revenue.federalGrants on UK/JP stateBudgets …");
const ukJpStates = await db
  .collection("states")
  .find({ countryId: { $in: ["UK", "JP"] } })
  .toArray();
const stateIds = ukJpStates.map((s) => s._id);
const stateBudgets = await db
  .collection("stateBudgets")
  .find({ _id: { $in: stateIds } })
  .toArray();

let totalCurrentZeroed = 0;
const updates = [];
for (const sb of stateBudgets) {
  const phantomGrants = sb.revenue?.federalGrants ?? 0;
  if (phantomGrants === 0) continue;
  totalCurrentZeroed += phantomGrants;

  const otherRevenue = (sb.revenue?.total ?? 0) - phantomGrants;
  const newRevenue = {
    ...sb.revenue,
    federalGrants: 0,
    total: Math.max(0, otherRevenue),
  };
  const newSurplus = newRevenue.total - (sb.spending?.total ?? 0);
  const newBalance = newSurplus; // clean cut — historical balance unreliable

  updates.push({
    _id: sb._id,
    phantomCurrent: phantomGrants,
    newRevenueTotal: newRevenue.total,
    newSurplus,
    oldBalance: sb.balance ?? 0,
    newBalance,
    op: {
      $set: {
        "revenue.federalGrants": 0,
        "revenue.total": newRevenue.total,
        surplus: newSurplus,
        balance: newBalance,
        updatedAt: new Date(),
      },
    },
  });
}

console.log(`  ${updates.length} stateBudget(s) carry phantom federalGrants:`);
for (const u of updates) {
  console.log(
    `    ${u._id}: zero current £${fmt(u.phantomCurrent)} | new revenue.total=£${fmt(u.newRevenueTotal)} | balance £${fmt(u.oldBalance)} → £${fmt(u.newBalance)}`
  );
}
console.log(`  TOTAL current-year phantom revenue removed: £${fmt(totalCurrentZeroed)}`);

if (!dryRun && updates.length > 0) {
  for (const u of updates) {
    await db.collection("stateBudgets").updateOne({ _id: u._id }, u.op);
  }
  console.log(`  Applied to ${updates.length} stateBudget(s).`);
}

// ── 3. Zero out federalBudget.spending.stateGrants on UK/JP if non-zero ─────
console.log("\n[3] Resetting federalBudget.spending.stateGrants for UK/JP …");
for (const c of COUNTRIES) {
  const fb = await db.collection("federalBudget").findOne({ _id: c.budgetId });
  if (!fb) {
    console.log(`  ${c.id}: no federalBudget doc — skipping`);
    continue;
  }
  const currentStateGrants = fb.spending?.stateGrants ?? 0;
  console.log(
    `  ${c.id}: current spending.stateGrants=${fmt(currentStateGrants)}, spending.total=${fmt(fb.spending?.total)}`
  );
  if (currentStateGrants === 0) {
    console.log(`    already 0, skipping`);
    continue;
  }
  const byCategorySum = sum(Object.values(fb.spending?.byCategory ?? {}));
  const debtInterest = fb.spending?.debtInterest ?? 0;
  const newSpending = {
    ...fb.spending,
    stateGrants: 0,
    total: byCategorySum + debtInterest, // recompute without phantom
  };
  const newSurplus = (fb.revenue?.total ?? 0) - newSpending.total;
  console.log(
    `    new spending.stateGrants=0, new spending.total=${fmt(newSpending.total)}, new surplus=${fmt(newSurplus)}`
  );
  if (!dryRun) {
    await db.collection("federalBudget").updateOne(
      { _id: c.budgetId },
      {
        $set: {
          spending: newSpending,
          surplus: newSurplus,
          updatedAt: new Date(),
        },
      }
    );
    console.log(`    applied`);
  }
}

console.log("\nDone.");
await client.close();
