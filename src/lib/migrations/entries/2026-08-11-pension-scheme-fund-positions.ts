import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

/**
 * A8 phase 2: a pension scheme can hold index-fund units, so it needs the same
 * one-position-per-holder-per-fund guard every other holder kind already has.
 *
 * Without it, two writers in the same turn would split a scheme's units across
 * two documents and the scheme's invested value would read as half of what it
 * is. That number feeds the funding ratio, so the failure would be silent and
 * would understate every scheme that hit the race.
 *
 * Partial on `pensionSchemeId` existing, matching the character / imperial /
 * NPP indexes in the index-fund foundation migration: positions of other kinds
 * carry no `pensionSchemeId` and must not collide on a missing field.
 */
type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    collection: "indexFundPositions",
    keys: { fundId: 1, holderKind: 1, pensionSchemeId: 1 },
    options: {
      name: "idx_indexFundPositions_pension_scheme_unique",
      unique: true,
      background: true,
      partialFilterExpression: { pensionSchemeId: { $exists: true } },
    },
  },
  {
    // The benefits and investment passes both sweep every scheme's positions by
    // scheme id, so the lookup that values a scheme's units must not collection
    // scan `indexFundPositions`.
    collection: "indexFundPositions",
    keys: { pensionSchemeId: 1 },
    options: {
      name: "idx_indexFundPositions_by_pension_scheme",
      background: true,
      partialFilterExpression: { pensionSchemeId: { $exists: true } },
    },
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
  id: "2026-08-11-pension-scheme-fund-positions",
  description: "One fund position per pension scheme per fund, and the scheme-side lookup index.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
