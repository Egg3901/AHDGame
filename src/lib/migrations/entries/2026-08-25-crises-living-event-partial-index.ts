import type { Db } from "mongodb";
import type { Migration, MigrationResult } from "../types";

/**
 * Repair the crises_living_event unique index and the null keys that break it.
 *
 * The index shipped as { unique: true, sparse: true }. Sparse skips documents
 * where the field is ABSENT, but the crisis template writer serialized an
 * undefined livingConflictEventId as an explicit null, which a sparse index
 * DOES key. The first null insert succeeded and every later one failed with
 * E11000 on { livingConflictEventId: null } — once per spawner turn in prod
 * (GlitchTip AHD-1JV, 23 events at time of writing).
 *
 * Three steps, in an order that cannot strand the collection without a
 * constraint mid-run:
 *   1. $unset the null-valued fields (a null-valued field also poisons the
 *      livingConflictEventId: { $exists: false } compat queries).
 *   2. Drop the legacy sparse index.
 *   3. Recreate it as a partial unique index on string-typed values, which
 *      excludes both null and missing keys by construction.
 *
 * The writer no longer emits the field when it has no value, and the index
 * seeder now authors the partial form for fresh worlds, so this migration is
 * the catch-up for worlds seeded before the fix.
 */
async function repairLivingEventIndex(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  const crises = db.collection("crises");

  const nullKeyed = await crises.countDocuments({ livingConflictEventId: null });
  const indexes = await crises.indexes().catch(() => []);
  const existing = indexes.find((index) => index.name === "crises_living_event");
  const needsRebuild =
    !!existing && !("partialFilterExpression" in existing && existing.partialFilterExpression);

  notes.push(`null-keyed crises: ${nullKeyed}`);
  notes.push(
    existing
      ? needsRebuild
        ? "crises_living_event present in legacy sparse form"
        : "crises_living_event already partial"
      : "crises_living_event missing"
  );

  if (dryRun) {
    notes.push("dry run: no writes performed");
    return { documentsScanned: nullKeyed, notes };
  }

  let documentsUpdated = 0;
  if (nullKeyed > 0) {
    const unsetResult = await crises.updateMany(
      { livingConflictEventId: null },
      { $unset: { livingConflictEventId: "" } }
    );
    documentsUpdated = unsetResult.modifiedCount;
    notes.push(`$unset null livingConflictEventId on ${documentsUpdated} crises`);
  }

  if (needsRebuild || !existing) {
    if (existing) {
      await crises.dropIndex("crises_living_event");
      notes.push("dropped legacy sparse crises_living_event");
    }
    await crises.createIndex(
      { livingConflictEventId: 1 },
      {
        name: "crises_living_event",
        unique: true,
        partialFilterExpression: { livingConflictEventId: { $type: "string" } },
      }
    );
    notes.push("created partial unique crises_living_event");
  }

  return { documentsScanned: nullKeyed, documentsUpdated, notes };
}

export const migration: Migration = {
  id: "2026-08-25-crises-living-event-partial-index",
  description:
    "Unset null livingConflictEventId keys and rebuild crises_living_event as a partial unique index (fixes per-turn E11000, GlitchTip AHD-1JV)",
  idempotent: true,
  execute: (db, ctx) => repairLivingEventIndex(db, ctx.dryRun),
};
