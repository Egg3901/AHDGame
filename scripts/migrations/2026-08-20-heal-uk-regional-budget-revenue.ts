/**
 * Heal script — UK regional budgets stuck at £0 revenue.
 *
 * The political-legislation v2 preset unseeds (and prunes) every legacy
 * `countryScope: "uk"` legislation type, but `seedUkBudgets` kept seeding one
 * statePolicy per legacy UK *regional* type. Those rows point at legislation
 * that no longer exists, and the UK regional-budget turn phase resolved its
 * council-tax / business-rates figures through exactly that lookup — so every
 * UK region collected £0 while the cost half kept pricing through the v2
 * catalog. All 12 regions sat in permanent deficit; London and Scotland ran
 * 91 and 98 consecutive turns of forced austerity, which downgrades a real
 * enacted regional programme one tier per turn.
 *
 * The code fix (regionalBudget.ts + seedUkBudgets.ts) stops both causes. This
 * script cleans up what the bug already wrote to the live world:
 *
 *   1. Deletes statePolicies whose legislationTypeId exists in NEITHER the
 *      legislationTypes collection NOR the v2 catalog — i.e. exactly the rows
 *      that seedStatePolicies' own stale-entry deleter removes on a reseed.
 *   2. Zeroes `turnsOverBudget` on the UK regionalBudgets. Left at 91/98, the
 *      "more than 1 consecutive turn" austerity trigger would fire again on the
 *      very first turn a region dips negative for any legitimate reason.
 *
 * It does NOT restore programmes austerity already downgraded: there is no
 * audit trail of their original levels, so any restore would be a guess.
 *
 * The revenue figures themselves need no backfill — processRegionalBudgets
 * recomputes and upserts every UK region each turn, so the first turn after
 * deploy writes the corrected numbers. The dry-run below PROJECTS those
 * numbers (using the production calculator) so they can be reviewed first.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-08-20-heal-uk-regional-budget-revenue.ts          # dry-run
 *   npx tsx scripts/migrations/2026-08-20-heal-uk-regional-budget-revenue.ts --apply  # execute
 *
 * Idempotent: a second run finds no dangling policies and no non-zero
 * turnsOverBudget, and reports a no-op.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { MongoClient, type Db } from "mongodb";
import { calculateRegionalBudget } from "../../src/lib/turn/regionalBudget";
import { getAllNewGenerationLawIds } from "../../src/lib/politicalLegislation/catalog";

const __d = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__d, "../../.env.local") });

const APPLY = process.argv.includes("--apply");

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) throw new Error("MONGODB_URI_LIVE is not set");
const client = new MongoClient(uri, { directConnection: true });

type Any = any;

const M = (n: number) => `£${(n / 1e6).toFixed(1)}M`;

function log(section: string) {
  console.log(`\n── ${section} ${"─".repeat(Math.max(0, 60 - section.length))}`);
}

async function main() {
  await client.connect();
  const db = client.db() as unknown as Db;

  const gs = (await db.collection("gameState").findOne({ _id: "current" } as Any)) as Any;
  console.log(
    `world: turn ${gs?.currentTurn} · ${gs?.currentYear} · preset ${gs?.preset} · mode ${APPLY ? "APPLY" : "DRY-RUN"}`
  );

  // ── 1. Dangling statePolicies ──────────────────────────────────────────────
  log("DANGLING statePolicies");
  const policies = (await db
    .collection("statePolicies")
    .find({})
    .project({ stateId: 1, legislationTypeId: 1, scope: 1 })
    .toArray()) as Any[];

  const referenced = [...new Set(policies.map((p) => p.legislationTypeId as string))];
  const existing = new Set(
    (
      (await db
        .collection("legislationTypes")
        .find({ _id: { $in: referenced } } as Any)
        .project({ _id: 1 })
        .toArray()) as Any[]
    ).map((d) => d._id as string)
  );
  // A v2 catalog law is legitimate even if its projected doc is absent.
  const catalogIds = new Set(getAllNewGenerationLawIds());

  const dangling = policies.filter(
    (p) => !existing.has(p.legislationTypeId) && !catalogIds.has(p.legislationTypeId)
  );
  const byType: Record<string, number> = {};
  for (const p of dangling) byType[p.legislationTypeId] = (byType[p.legislationTypeId] ?? 0) + 1;

  if (dangling.length === 0) {
    console.log("none — already clean");
  } else {
    console.log(
      `${dangling.length} rows across ${Object.keys(byType).length} legislation type(s):`
    );
    for (const [id, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)} × ${id}`);
    }
  }

  // ── 2. UK regional budgets ────────────────────────────────────────────────
  log("UK regionalBudgets — projected under the fixed model");
  const regions = (await db
    .collection("states")
    .find({ countryId: "UK" })
    .project({ _id: 1, population: 1, gdp: 1 })
    .toArray()) as Any[];
  const nationalPopulation = regions.reduce((s, r) => s + (r.population ?? 0), 0);

  const fb = (await db.collection("federalBudget").findOne({ _id: "UK" } as Any)) as Any;
  const grantPool = fb?.spending?.stateGrants || fb?.baselineStateGrants || 0;
  console.log(
    `grant pool ${M(grantPool)} (spending.stateGrants ${M(fb?.spending?.stateGrants ?? 0)}, baseline ${M(fb?.baselineStateGrants ?? 0)})\n`
  );

  const budgets = (await db
    .collection("regionalBudgets")
    .find({ countryId: "UK" })
    .toArray()) as Any[];
  const budgetById = new Map(budgets.map((b) => [b._id as string, b]));

  console.log(
    "region   pop        gdp        council    rates      grant      total      costs      surplus    over"
  );
  let overBudgetAfter = 0;
  for (const r of regions.sort((a, b) => (b.gdp ?? 0) - (a.gdp ?? 0))) {
    const b = budgetById.get(r._id as string);
    const propBase = b?.propertyValueBaseline ?? 120_000;
    const commBase = b?.commercialValueBaseline ?? 45_000;
    const projected = calculateRegionalBudget({
      regionGdp: (r.gdp ?? 0) * 1_000_000,
      propertyValueIndex: propBase > 0 ? (b?.propertyValuePerCapita ?? propBase) / propBase : 1,
      commercialValueIndex: commBase > 0 ? (b?.commercialValuePerCapita ?? commBase) / commBase : 1,
      regionPopulation: r.population ?? 0,
      nationalPopulation,
      grantPool,
      chancellorAllocation: b?.chancellorAllocation ?? null,
    });
    const costs = b?.enactedBillCosts ?? 0;
    const surplus = projected.totalBudget - costs;
    if (surplus < 0) overBudgetAfter++;
    console.log(
      `${String(r._id).padEnd(8)} ${String(r.population).padStart(9)} ${M((r.gdp ?? 0) * 1e6).padStart(10)} ` +
        `${M(projected.councilTaxRevenue).padStart(10)} ${M(projected.businessRatesRevenue).padStart(10)} ` +
        `${M(projected.westminsterGrant).padStart(10)} ${M(projected.totalBudget).padStart(10)} ` +
        `${M(costs).padStart(10)} ${M(surplus).padStart(10)} ${String(b?.turnsOverBudget ?? 0).padStart(4)}`
    );
  }
  console.log(
    `\nregions still in deficit under the fixed model: ${overBudgetAfter}/${regions.length}`
  );

  const needsReset = budgets.filter((b) => (b.turnsOverBudget ?? 0) > 0);
  console.log(
    `turnsOverBudget to clear: ${needsReset.length} region(s) — ${
      needsReset.map((b) => `${b._id}=${b.turnsOverBudget}`).join(", ") || "none"
    }`
  );

  // ── 3. Write ──────────────────────────────────────────────────────────────
  log(APPLY ? "APPLYING" : "DRY-RUN — no writes");
  if (!APPLY) {
    console.log("Re-run with --apply to execute the two changes above.");
    return;
  }

  if (dangling.length > 0) {
    const res = await db
      .collection("statePolicies")
      .deleteMany({ legislationTypeId: { $in: Object.keys(byType) } } as Any);
    console.log(`deleted ${res.deletedCount} dangling statePolicies`);
  }

  if (needsReset.length > 0) {
    const res = await db
      .collection("regionalBudgets")
      .updateMany({ countryId: "UK" } as Any, { $set: { turnsOverBudget: 0 } });
    console.log(`cleared turnsOverBudget on ${res.modifiedCount} UK regionalBudgets`);
  }

  console.log(
    "\nDone. The next turn's regional-budget phase writes the corrected revenue figures."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.close());
