/**
 * Migration: assign `conflictId` to conflicts written before the field existed.
 *
 * Numbers are handed out in `startTurn` order (then `_id`, for determinism when two
 * wars began on the same turn) so the sequence reflects the order they started. The
 * shared counter is then advanced past the highest assigned value, so the next
 * `createConflict` cannot collide with a backfilled number behind the unique index.
 *
 * Idempotent: conflicts already carrying a `conflictId` are skipped, and the counter
 * only ever moves forward (`$max`), so a re-run — or a counter already ahead of the
 * backfill — cannot hand out a duplicate.
 *
 * Usage: npx tsx scripts/migrations/2026-07-26-conflict-sequential-ids.ts [--dry-run]
 */
import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";

export interface ConflictIdBackfillResult {
  assigned: number;
  alreadyNumbered: number;
  /** The value the shared counter was raised to, or 0 when nothing was assigned. */
  counterAdvancedTo: number;
}

export async function backfillConflictIds(
  db: Db,
  dryRun = false
): Promise<ConflictIdBackfillResult> {
  const col = db.collection("conflicts");
  const alreadyNumbered = await col.countDocuments({ conflictId: { $exists: true } });

  const unnumbered = await col
    .find({ conflictId: { $exists: false } })
    .sort({ startTurn: 1, _id: 1 })
    .toArray();

  const highest = await col
    .find({ conflictId: { $exists: true } })
    .sort({ conflictId: -1 })
    .limit(1)
    .toArray();

  let next = ((highest[0]?.conflictId as number | undefined) ?? 0) + 1;
  const counterAdvancedTo = unnumbered.length > 0 ? next + unnumbered.length - 1 : 0;

  if (!dryRun) {
    for (const doc of unnumbered) {
      await col.updateOne({ _id: doc._id }, { $set: { conflictId: next } });
      next++;
    }
    if (counterAdvancedTo > 0) {
      await db
        .collection("counters")
        .updateOne(
          { _id: "conflict" } as never,
          { $max: { seq: counterAdvancedTo } },
          { upsert: true }
        );
    }
  }

  return { assigned: unnumbered.length, alreadyNumbered, counterAdvancedTo };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();
  try {
    const r = await backfillConflictIds(db, dryRun);
    console.log(
      `${dryRun ? "[DRY RUN] " : ""}assigned=${r.assigned}, alreadyNumbered=${r.alreadyNumbered}, counter=${r.counterAdvancedTo}`
    );
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
