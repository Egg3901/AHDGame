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
      // `$type: "null"` rather than `$exists: false`: MongoDB REJECTS an
      // absent-field test in a partial index ("Expression not supported in
      // partial index: $not"), so the original form could never be built in any
      // environment, and prod kept the old outright-unique index that blocks
      // founding a rival. Seeded unions therefore carry an EXPLICIT null, which
      // the backfill below guarantees before the index is created.
      partialFilterExpression: { foundedByCharacterId: { $type: "null" } },
    },
  },
];

/**
 * Give every union nobody founded an explicit `foundedByCharacterId: null`.
 *
 * The partial index keys off `$type: "null"`, which matches an explicit null and
 * NOT an absent field, so seeded documents must carry the field for the guard to
 * cover them. Idempotent: only documents missing the field are touched.
 */
async function backfillSeededFounderNull(db: Db, dryRun: boolean): Promise<string> {
  const filter = { foundedByCharacterId: { $exists: false } };
  if (dryRun) {
    const pending = await db.collection("unions").countDocuments(filter);
    return `would set foundedByCharacterId: null on ${pending} seeded union(s)`;
  }
  const result = await db.collection("unions").updateMany(filter, {
    $set: { foundedByCharacterId: null },
  });
  return `set foundedByCharacterId: null on ${result.modifiedCount} seeded union(s)`;
}

async function createPlannedIndexes(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];

  // Must run BEFORE the index build: the partial filter only covers documents
  // that actually carry the field.
  notes.push(await backfillSeededFounderNull(db, dryRun));

  // Create BEFORE drop: the names differ, so the partial index can be built
  // while the legacy outright-unique one still stands. If the build fails
  // (e.g. a world already carrying duplicate seeded docs in one pair throws
  // E11000), the migration aborts with the old guard still in place, rather
  // than having dropped it first and left the collection unprotected.
  for (const plan of INDEXES) {
    const label = `${plan.collection}.${plan.options.name}`;
    if (dryRun) {
      notes.push(`would create ${label}`);
      continue;
    }
    await db.collection(plan.collection).createIndex(plan.keys, plan.options);
    notes.push(`created/verified ${label}`);
  }

  // Drop the legacy outright-unique index: an environment that already ran the
  // original version of this migration carries it, and it would reject the
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
    } catch (error) {
      // IndexNotFound (code 27) is the normal path: most environments never
      // ran the original. Anything else (permissions, in-progress build) means
      // the legacy index may still exist and would block founding at the DB
      // level while the migration reported success, so fail loudly instead.
      const code = (error as { code?: unknown; codeName?: unknown }) ?? {};
      if (code.code === 27 || code.codeName === "IndexNotFound") {
        notes.push(`${label} not present`);
      } else {
        throw error;
      }
    }
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
