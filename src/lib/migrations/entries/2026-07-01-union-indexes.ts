import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    // v3 Phase 8 code-review fix: without this, two concurrent first-claims
    // on a never-before-touched (countryId, sectorType) pair could each
    // insert their own Union document via claimUnion.ts's lazy upsert,
    // producing two "leaders" of the same industry on the leaderboard.
    collection: "unions",
    keys: { countryId: 1, sectorType: 1 },
    options: {
      name: "unions_country_sectorType_unique",
      unique: true,
      background: true,
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
  id: "2026-07-01-union-indexes",
  description: "Unique (countryId, sectorType) guard for the unions collection.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
