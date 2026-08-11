/**
 * Re-materialize cost fractions for enacted healthcare laws after a
 * COST_SHARE_OVERRIDES change (issue #3137 / ticket #953).
 *
 * Enacted laws snapshot gdpCostFraction/incomeCostFraction at enactment and
 * never re-read the catalog, and the Mongo legislationTypes collection only
 * refreshes on a full reseed — so a catalog change alone is a prod no-op.
 * This script, scoped to the typeIds in COST_SHARE_OVERRIDES:
 *   1. updates each legislationTypes doc's policyOptions fractions from the
 *      freshly materialized in-code seed (fractions only — nothing else), and
 *   2. rewrites each active enactedLaws doc's fractions from the seed option
 *      at that law's recorded policyOptionIndex (player-chosen options are
 *      preserved; only the price of the chosen option changes).
 *
 * The new spending lines land on the next fiscal-year turn phase, or run
 * POST /api/admin/heal/federal-budgets (fix mode) to apply immediately.
 *
 *   npx tsx scripts/migrate-enacted-law-healthcare-fractions.ts [--apply]
 *
 * Omit --apply for a dry run (prints planned updates, no writes).
 */
import * as dotenv from "dotenv";
import { connectDb, closeDb } from "./utils/db";
import { COST_SHARE_OVERRIDES } from "@/lib/era/legislationCostCatalog";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import type { EnactedLaw } from "@/lib/db/types/budget";

dotenv.config({ path: ".env.local" });

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const typeIds = Object.keys(COST_SHARE_OVERRIDES);
  const seedById = new Map(
    legislationTypes.filter((t) => typeIds.includes(t._id)).map((t) => [t._id, t])
  );
  const missing = typeIds.filter((id) => !seedById.has(id));
  if (missing.length > 0) {
    console.error(`Override typeIds missing from seed export: ${missing.join(", ")}`);
    process.exit(1);
  }

  const db = await connectDb();

  let typeUpdates = 0;
  for (const [typeId, seed] of seedById) {
    const opts = seed.policyOptions ?? [];
    const sets: Record<string, unknown> = {};
    opts.forEach((o, i) => {
      if (o.gdpCostFraction !== undefined)
        sets[`policyOptions.${i}.gdpCostFraction`] = o.gdpCostFraction;
      if (o.incomeCostFraction !== undefined)
        sets[`policyOptions.${i}.incomeCostFraction`] = o.incomeCostFraction;
    });
    if (Object.keys(sets).length === 0) continue;
    console.log(`[type] ${typeId}: ${Object.keys(sets).length} option fraction(s)`);
    if (apply) {
      const r = await db
        .collection("legislationTypes")
        .updateOne({ _id: typeId as never }, { $set: sets });
      typeUpdates += r.modifiedCount;
    }
  }

  const laws = await db
    .collection<EnactedLaw>("enactedLaws")
    .find({ legislationTypeId: { $in: typeIds }, repealedAt: { $exists: false } })
    .toArray();
  let lawUpdates = 0;
  for (const law of laws) {
    const seed = seedById.get(law.legislationTypeId);
    const idx = law.policyOptionIndex;
    const opt = typeof idx === "number" ? seed?.policyOptions?.[idx] : undefined;
    if (!opt) {
      console.warn(
        `[law ] ${law.legislationTypeId} (${String(law._id)}): no seed option at index ${idx} — SKIPPED`
      );
      continue;
    }
    const sets: Record<string, unknown> = {};
    if (opt.gdpCostFraction !== undefined && opt.gdpCostFraction !== law.gdpCostFraction)
      sets.gdpCostFraction = opt.gdpCostFraction;
    if (opt.incomeCostFraction !== undefined && opt.incomeCostFraction !== law.incomeCostFraction)
      sets.incomeCostFraction = opt.incomeCostFraction;
    if (Object.keys(sets).length === 0) {
      console.log(`[law ] ${law.legislationTypeId} (${String(law._id)}): already current`);
      continue;
    }
    console.log(
      `[law ] ${law.legislationTypeId} opt ${idx} (${String(law._id)}): income ${law.incomeCostFraction} -> ${
        sets.incomeCostFraction ?? law.incomeCostFraction
      }, gdp ${law.gdpCostFraction} -> ${sets.gdpCostFraction ?? law.gdpCostFraction}`
    );
    if (apply) {
      const r = await db.collection("enactedLaws").updateOne({ _id: law._id }, { $set: sets });
      lawUpdates += r.modifiedCount;
    }
  }

  console.log(
    apply
      ? `APPLIED: ${typeUpdates} legislationTypes doc(s), ${lawUpdates} enactedLaws doc(s) updated.`
      : `DRY RUN: ${seedById.size} type(s), ${laws.length} active law(s) inspected. Re-run with --apply.`
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
