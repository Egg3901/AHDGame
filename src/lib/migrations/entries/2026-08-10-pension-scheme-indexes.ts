import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

/**
 * A8 indexes for `pensionSchemes` and the agreement read that drives the
 * pension turn.
 *
 * One scheme per union, enforced rather than assumed: `ensurePensionScheme`
 * races with itself the first time two agreements for the same union settle in
 * the same turn, and two scheme documents for one union would split its assets
 * in half with no error anywhere.
 */
type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    collection: "pensionSchemes",
    keys: { unionId: 1 },
    options: { name: "unique_pension_scheme_per_union", unique: true, background: true },
  },
  {
    collection: "pensionSchemes",
    keys: { countryId: 1 },
    options: { name: "pension_schemes_by_country", background: true },
  },
  {
    // The pension turn's only sweep: active agreements that actually carry a
    // contribution. Sparse, because the overwhelming majority of agreements
    // never bargain a pension and should not sit in this index at all.
    collection: "collectiveAgreements",
    keys: { pensionContributionRate: 1, status: 1, expiresAtTurn: 1 },
    options: { name: "collective_agreements_pension_active", sparse: true, background: true },
  },
];

async function createPlannedIndexes(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  for (const plan of INDEXES) {
    const label = `${plan.collection}.${plan.options.name}`;
    if (dryRun) {
      notes.push(`would create ${label}`);
      continue;
    }
    await db.collection(plan.collection).createIndex(plan.keys, plan.options);
    notes.push(`created/verified ${label}`);
  }
  return {
    documentsScanned: INDEXES.length,
    documentsUpdated: dryRun ? 0 : INDEXES.length,
    notes,
  };
}

export const migration: Migration = {
  id: "2026-08-10-pension-scheme-indexes",
  description: "One-scheme-per-union guard and the pension turn's agreement sweep index.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
