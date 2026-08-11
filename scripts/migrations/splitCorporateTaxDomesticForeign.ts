/**
 * Migration — split legacy `corporateTax` / `corporateProfits` into domestic + foreign.
 *
 * Forward migration (`migrate`):
 *   1. Rename 5 legacy legislation bill ids to `*_domestic_*` (US federal + state, UK, JP, DE).
 *   2. Remap `legislationTypeId` across enactedLaws, bills, committeeAssignments, statePolicyRecords.
 *   3. Split federalBudget.taxRates.corporateTax → both new fields (same value);
 *      split taxBases.corporateProfits 75/25 into domestic/foreign; `$unset` the legacy keys.
 *   4. Drop legacy `revenue.corporateTax`; next step recalculates from split bases.
 *   5. Recalculate federalBudget.revenue via `calculateFederalRevenue`.
 *   6. Same treatment for stateBudgets (split rate, 75/25 base split, revenue recalc).
 *
 * Idempotent: docs already migrated (lacking the legacy fields) are skipped.
 *
 * Rollback (`rollback`): safe ONLY if no foreign bill has been enacted yet. Detects
 * divergence (domesticRate !== foreignRate on any budget) and refuses. On success,
 * collapses the two split fields back into a single `corporateTax` (= domestic value)
 * and restores the legacy legislation ids. Intended as a recovery path during the
 * PR 1 cutover window; once PR 2 lands and real foreign bills pass, rollback is
 * no longer lossless.
 *
 * Usage:
 *   npx tsx scripts/migrations/splitCorporateTaxDomesticForeign.ts migrate
 *   npx tsx scripts/migrations/splitCorporateTaxDomesticForeign.ts rollback
 */

import { connectDb, closeDb } from "../utils/db";
import { calculateFederalRevenue, calculateStateRevenue } from "../../src/lib/budget/revenue";
import type { Db } from "mongodb";
import type { FederalBudget, StateBudget } from "../../src/lib/db/types/budget";
import type { State } from "../../src/lib/db/types/state";
import type { LegislationType } from "../../src/lib/db/types/legislation";

export const LEGACY_TO_NEW_IDS: Record<string, string> = {
  us_federal_corporate_tax_rate: "us_federal_domestic_corporate_tax_rate",
  us_state_corporate_tax_rate: "us_state_domestic_corporate_tax_rate",
  uk_corporation_tax: "uk_domestic_corporation_tax",
  jp_corporation_tax: "jp_domestic_corporation_tax",
  de_corporate_tax_rate: "de_domestic_corporate_tax_rate",
};

const REMAPPED_COLLECTIONS = [
  "enactedLaws",
  "bills",
  "committeeAssignments",
  "statePolicyRecords",
] as const;

interface LegacyBudgetShape {
  _id: string;
  taxRates?: {
    corporateTax?: number;
    domesticCorporateTax?: number;
    foreignCorporateTax?: number;
  } & Record<string, number>;
  taxBases?: {
    corporateProfits?: number;
    domesticCorporateProfits?: number;
    foreignCorporateProfits?: number;
  } & Record<string, number>;
  revenue?: { federalGrants?: number } & Record<string, unknown>;
}

async function renameLegislationTypes(db: Db): Promise<number> {
  let renamed = 0;
  for (const [legacyId, newId] of Object.entries(LEGACY_TO_NEW_IDS)) {
    const legacy = (await db
      .collection<LegislationType>("legislationTypes")
      .findOne({ _id: legacyId as unknown as LegislationType["_id"] })) as
      (LegislationType & Record<string, unknown>) | null;
    if (!legacy) continue;

    // Insert domestic copy with updated fields (if it doesn't already exist from the seed).
    const legacyScope =
      (legacy.taxRateChange as { scope?: "state" | "federal" } | undefined)?.scope ?? "federal";
    await db.collection<LegislationType>("legislationTypes").updateOne(
      { _id: newId as unknown as LegislationType["_id"] },
      {
        $setOnInsert: {
          ...legacy,
          _id: newId,
          name: renameForDomestic(typeof legacy.name === "string" ? legacy.name : ""),
          description: renameForDomestic(
            typeof legacy.description === "string" ? legacy.description : ""
          ),
          subCategory: "Corporate taxation",
          taxRateChange: {
            scope: legacyScope,
            taxType: "domesticCorporateTax",
          },
        },
      },
      { upsert: true }
    );
    await db
      .collection<LegislationType>("legislationTypes")
      .deleteOne({ _id: legacyId as unknown as LegislationType["_id"] });
    renamed++;
    console.log(`  renamed legislationType: ${legacyId} → ${newId}`);
  }
  return renamed;
}

async function remapReferences(db: Db): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const coll of REMAPPED_COLLECTIONS) {
    let total = 0;
    for (const [legacyId, newId] of Object.entries(LEGACY_TO_NEW_IDS)) {
      const res = await db
        .collection(coll)
        .updateMany({ legislationTypeId: legacyId }, { $set: { legislationTypeId: newId } });
      total += res.modifiedCount;
    }
    counts[coll] = total;
    if (total > 0) console.log(`  remapped ${total} ${coll} docs`);
  }
  return counts;
}

async function splitBudgetDocs(
  db: Db,
  collection: "federalBudget" | "stateBudgets"
): Promise<number> {
  const docs = (await db
    .collection(collection)
    .find({})
    .toArray()) as unknown as LegacyBudgetShape[];
  let migrated = 0;

  for (const budget of docs) {
    const legacyRate = budget.taxRates?.corporateTax;
    const legacyBase = budget.taxBases?.corporateProfits;
    const alreadyMigrated =
      legacyRate === undefined &&
      legacyBase === undefined &&
      (budget.taxRates?.domesticCorporateTax !== undefined ||
        budget.taxBases?.domesticCorporateProfits !== undefined);
    if (alreadyMigrated) continue;
    if (legacyRate === undefined && legacyBase === undefined) continue;

    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ""> = {};

    if (legacyRate !== undefined) {
      // Day-one parity: foreign defaults to the same value as domestic.
      $set["taxRates.domesticCorporateTax"] = legacyRate;
      $set["taxRates.foreignCorporateTax"] = legacyRate;
      $unset["taxRates.corporateTax"] = "";
    }
    if (legacyBase !== undefined) {
      // 75/25 bootstrap split per spec. Next corp turn overwrites both fields with
      // actual accumulated income so the ratio self-corrects within a turn.
      $set["taxBases.domesticCorporateProfits"] = legacyBase * 0.75;
      $set["taxBases.foreignCorporateProfits"] = legacyBase * 0.25;
      $unset["taxBases.corporateProfits"] = "";
    }
    // Drop legacy revenue field regardless; recomputed below.
    $unset["revenue.corporateTax"] = "";

    await db
      .collection<LegacyBudgetShape>(collection)
      .updateOne({ _id: budget._id }, { $set, $unset });
    migrated++;
  }

  console.log(`  split ${migrated} ${collection} doc(s)`);
  return migrated;
}

async function recalculateRevenue(db: Db): Promise<void> {
  // Federal
  const federalBudgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();
  for (const budget of federalBudgets) {
    if (!budget.taxRates) continue;
    const revenue = await calculateFederalRevenue(db, budget.taxRates, budget._id);
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id: budget._id }, { $set: { revenue, updatedAt: new Date() } });
  }
  console.log(`  recalculated revenue for ${federalBudgets.length} federalBudget doc(s)`);

  // State
  const stateBudgets = await db.collection<StateBudget>("stateBudgets").find({}).toArray();
  const allStates = await db.collection<State>("states").find({}).toArray();
  const stateMap = new Map(allStates.map((s) => [s._id, s]));
  for (const budget of stateBudgets) {
    if (!budget.taxRates) continue;
    const federalGrants = budget.revenue?.federalGrants ?? 0;
    const budgetCountryId = (stateMap.get(budget.stateId)?.countryId ??
      "US") as import("@/lib/constants/countries").CountryId;
    const revenue = await calculateStateRevenue(
      db,
      budget._id as string,
      budgetCountryId,
      budget.taxRates,
      federalGrants
    );
    await db
      .collection<StateBudget>("stateBudgets")
      .updateOne({ _id: budget._id }, { $set: { revenue, updatedAt: new Date() } });
  }
  console.log(`  recalculated revenue for ${stateBudgets.length} stateBudgets doc(s)`);
}

/** Best-effort cosmetic rename; admin can adjust post-migration if needed. */
function renameForDomestic(text: string): string {
  return text
    .replace(/Corporate Tax Rate/g, "Domestic Corporate Tax Rate")
    .replace(/Corporation Tax Rate/g, "Domestic Corporation Tax Rate")
    .replace(/Corporation Tax Act/g, "Domestic Corporation Tax Act")
    .replace(/Corporation Tax/g, "Domestic Corporation Tax");
}

export async function migrate(): Promise<void> {
  console.log("Starting domestic/foreign corp tax split migration...");
  const db = await connectDb();

  console.log("1. Rename legislationTypes...");
  await renameLegislationTypes(db);

  console.log("2. Remap legislationTypeId references...");
  await remapReferences(db);

  console.log("3. Split federalBudget docs...");
  await splitBudgetDocs(db, "federalBudget");

  console.log("4. Split stateBudgets docs...");
  await splitBudgetDocs(db, "stateBudgets");

  console.log("5. Recalculate revenue...");
  await recalculateRevenue(db);

  await closeDb();
  console.log("Migration complete.");
}

export async function rollback(): Promise<void> {
  console.log("Starting rollback of domestic/foreign corp tax split...");
  const db = await connectDb();

  // Safety check: refuse if any foreign rate diverges from its domestic counterpart.
  const divergent: string[] = [];
  for (const coll of ["federalBudget", "stateBudgets"] as const) {
    const docs = (await db.collection(coll).find({}).toArray()) as unknown as LegacyBudgetShape[];
    for (const b of docs) {
      const d = b.taxRates?.domesticCorporateTax;
      const f = b.taxRates?.foreignCorporateTax;
      if (typeof d === "number" && typeof f === "number" && d !== f) {
        divergent.push(`${coll}:${b._id} (domestic=${d}, foreign=${f})`);
      }
    }
  }
  if (divergent.length > 0) {
    await closeDb();
    throw new Error(
      `Refusing to rollback — ${divergent.length} budget(s) have divergent rates:\n  ` +
        divergent.slice(0, 10).join("\n  ") +
        (divergent.length > 10 ? `\n  ...and ${divergent.length - 10} more` : "")
    );
  }

  // Collapse fields back
  const collapse = async (coll: "federalBudget" | "stateBudgets") => {
    const docs = (await db.collection(coll).find({}).toArray()) as unknown as LegacyBudgetShape[];
    let collapsed = 0;
    for (const b of docs) {
      const d = b.taxRates?.domesticCorporateTax;
      const domBase = b.taxBases?.domesticCorporateProfits ?? 0;
      const forBase = b.taxBases?.foreignCorporateProfits ?? 0;
      const $set: Record<string, unknown> = {};
      const $unset: Record<string, ""> = {};
      if (typeof d === "number") {
        $set["taxRates.corporateTax"] = d;
        $unset["taxRates.domesticCorporateTax"] = "";
        $unset["taxRates.foreignCorporateTax"] = "";
      }
      if (domBase > 0 || forBase > 0) {
        $set["taxBases.corporateProfits"] = domBase + forBase;
        $unset["taxBases.domesticCorporateProfits"] = "";
        $unset["taxBases.foreignCorporateProfits"] = "";
      }
      $unset["revenue.domesticCorporateTax"] = "";
      $unset["revenue.foreignCorporateTax"] = "";
      if (Object.keys($set).length > 0 || Object.keys($unset).length > 0) {
        await db.collection<LegacyBudgetShape>(coll).updateOne({ _id: b._id }, { $set, $unset });
        collapsed++;
      }
    }
    console.log(`  collapsed ${collapsed} ${coll} doc(s)`);
  };
  await collapse("federalBudget");
  await collapse("stateBudgets");

  // Reverse legislation remapping
  const NEW_TO_LEGACY = Object.fromEntries(
    Object.entries(LEGACY_TO_NEW_IDS).map(([legacy, current]) => [current, legacy])
  );
  for (const [newId, legacyId] of Object.entries(NEW_TO_LEGACY)) {
    const doc = (await db
      .collection<LegislationType>("legislationTypes")
      .findOne({ _id: newId as unknown as LegislationType["_id"] })) as
      (LegislationType & Record<string, unknown>) | null;
    if (doc) {
      // Rollback writes the legacy taxType literal back. The type union no longer includes
      // "corporateTax", so cast — this code path only runs when restoring the pre-migration
      // shape, which is intentionally incompatible with the current type union.
      const legacyTaxRateChange = {
        ...((doc.taxRateChange as Record<string, unknown>) ?? {}),
        taxType: "corporateTax",
      } as unknown as LegislationType["taxRateChange"];
      await db.collection<LegislationType>("legislationTypes").updateOne(
        { _id: legacyId as unknown as LegislationType["_id"] },
        {
          $setOnInsert: {
            ...doc,
            _id: legacyId,
            taxRateChange: legacyTaxRateChange,
          },
        },
        { upsert: true }
      );
      await db
        .collection<LegislationType>("legislationTypes")
        .deleteOne({ _id: newId as unknown as LegislationType["_id"] });
    }
    for (const coll of REMAPPED_COLLECTIONS) {
      await db
        .collection(coll)
        .updateMany({ legislationTypeId: newId }, { $set: { legislationTypeId: legacyId } });
    }
  }

  await closeDb();
  console.log("Rollback complete.");
}

// CLI entry
if (require.main === module) {
  const cmd = process.argv[2] ?? "migrate";
  const fn = cmd === "rollback" ? rollback : migrate;
  fn().catch((err) => {
    console.error(`${cmd} failed:`, err);
    process.exit(1);
  });
}
