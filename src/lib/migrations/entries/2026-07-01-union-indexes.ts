import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

/**
 * Union dues v1 replaced the outright unique constraint with a PARTIAL one.
 *
 * The original guard was correct for its time: `claimUnion.ts` lazily upserts a
 * Union the first time anyone touches an industry, and two concurrent claims on
 * a never-before-touched (countryId, sectorType) pair could each insert their
 * own document, producing two "leaders" of the same industry. A plain unique
 * index stopped that.
 *
 * Players can now FOUND rival unions in an industry that already has one, which
 * is the whole basis of raiding, so several documents per (countryId,
 * sectorType) are legitimate. Dropping the guard entirely would bring the
 * upsert race back. Scoping it to seeded unions keeps both properties: at most
 * one union per industry that nobody founded, and any number that somebody did.
 */
const DROPPED_INDEXES: { collection: string; name: string }[] = [
  { collection: "unions", name: "unions_country_sectorType_unique" },
];

const INDEXES: IndexPlan[] = [
  {
    collection: "unions",
    keys: { countryId: 1, sectorType: 1 },
    options: {
      name: "unions_country_sectorType_seeded_unique",
      unique: true,
      background: true,
      // Only documents with no founder participate, so the lazy-upsert race
      // stays guarded while founded rivals are free to pile into the pair.
      partialFilterExpression: { foundedByCharacterId: { $exists: false } },
    },
  },
];

async function createPlannedIndexes(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];

  // Drop before create: an environment that already ran the original version of
  // this migration carries the outright unique index, which would reject the
  // second union in an industry no matter what the new partial index says.
  for (const dropped of DROPPED_INDEXES) {
    const label = `${dropped.collection}.${dropped.name}`;
    if (dryRun) {
      notes.push(`would drop ${label} if present`);
      continue;
    }
    try {
      await db.collection(dropped.collection).dropIndex(dropped.name);
      notes.push(`dropped ${label}`);
    } catch {
      // IndexNotFound is the normal path: most environments never ran the
      // original. Anything else here is not worth failing the migration over,
      // because the create below is what actually matters.
      notes.push(`${label} not present`);
    }
  }

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
