import type { Db, Document } from "mongodb";
import type { Migration, MigrationResult } from "../types";
import {
  collectSeedIndexPlan,
  findMissingSeedIndexes,
  isTextIndex,
  isTtlIndex,
  type SeedIndexPlanEntry,
} from "@/lib/admin/seed/indexes/plan";

const DUPLICATE_KEY = 11000;

/** Keys of a unique index that more than one document shares (within its partial filter). */
async function duplicateKeyCount(db: Db, entry: SeedIndexPlanEntry): Promise<number> {
  const fields = Object.keys(entry.key);
  const match: Document = { ...(entry.options.partialFilterExpression ?? {}) };
  if (entry.options.sparse) {
    for (const field of fields) match[field] = { ...(match[field] ?? {}), $exists: true };
  }
  const rows = await db
    .collection(entry.collection)
    .aggregate(
      [
        { $match: match },
        {
          $group: {
            _id: Object.fromEntries(fields.map((f) => [f.replace(/\./g, "_"), `$${f}`])),
            n: { $sum: 1 },
          },
        },
        { $match: { n: { $gt: 1 } } },
        { $count: "duplicates" },
      ],
      { allowDiskUse: true }
    )
    .toArray();
  return (rows[0]?.duplicates as number | undefined) ?? 0;
}

/**
 * Create seed-defined indexes that a running world never received (#2699).
 *
 * A live world never re-seeds, so every index added to a seed module without
 * its own migration was missing in production (47 at the 2026-09-30 audit).
 * This derives the plan from `seedIndexes` itself and creates what is absent.
 *
 * Deliberately skipped, and reported:
 * - Text indexes. They add many keys per insert on the busiest logs; adding
 *   them to a live world needs its own insert-cost decision.
 * - TTL indexes. Creating one deletes every already-expired document.
 * - Unique indexes whose keys already have duplicates. Building them would
 *   fail; the duplicates need an owner-reviewed repair first.
 *
 * Registry only: it ships with the code that relies on these constraints, and
 * large builds must not delay boot. Idempotent: rerun with `--only <id>
 * --force` after new seed indexes land to reconcile them too.
 */
export const migration: Migration = {
  id: "2026-10-01-reconcile-seed-indexes",
  description:
    "Create missing seed-defined indexes on a live world (skips text, TTL and duplicate-blocked unique).",
  idempotent: true,
  execute: async (db, ctx): Promise<MigrationResult> => {
    const plan = await collectSeedIndexPlan();
    const missing = await findMissingSeedIndexes(db, plan);
    const notes: string[] = [`${plan.length} seed indexes planned, ${missing.length} missing`];
    let created = 0;
    for (const entry of missing) {
      const label = `${entry.collection}.${entry.options.name ?? JSON.stringify(entry.key)}`;
      if (isTextIndex(entry)) {
        notes.push(`skipped ${label}: text index needs an insert-cost decision`);
        continue;
      }
      if (isTtlIndex(entry)) {
        notes.push(`skipped ${label}: TTL index would delete expired documents`);
        continue;
      }
      if (entry.options.unique) {
        const duplicates = await duplicateKeyCount(db, entry);
        if (duplicates > 0) {
          notes.push(`skipped ${label}: ${duplicates} duplicate key(s) need repair first`);
          continue;
        }
      }
      if (ctx.dryRun) {
        notes.push(`would create ${label}`);
        continue;
      }
      try {
        await db.collection(entry.collection).createIndex(entry.key as never, entry.options);
        created += 1;
        notes.push(`created ${label}`);
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code !== DUPLICATE_KEY) throw error;
        notes.push(`skipped ${label}: duplicate key appeared during build`);
      }
    }
    return { documentsScanned: plan.length, documentsUpdated: created, notes };
  },
};
