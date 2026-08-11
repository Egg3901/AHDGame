// Pre-write snapshots and rollback.
//
// This Mongo is a single-node replica set reached with directConnection=true,
// so multi-document transactions are not available. There is no "abort" to
// fall back on: the backup collection IS the rollback. Every document a plan
// declares in `touched` is copied to `healBackups` and READ BACK before the
// heal is allowed to make its first write.

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { HealBackup, HealResult, TouchedDocs } from "./types";

export const HEAL_BACKUPS_COLLECTION = "healBackups";

export async function ensureBackupIndexes(db: Db): Promise<void> {
  await db.collection<HealBackup>(HEAL_BACKUPS_COLLECTION).createIndex({ runId: 1 });
  await db
    .collection<HealBackup>(HEAL_BACKUPS_COLLECTION)
    .createIndex({ runId: 1, collection: 1, docId: 1 }, { unique: true });
  await db
    .collection<HealBackup>(HEAL_BACKUPS_COLLECTION)
    .createIndex({ defectId: 1, createdAt: -1 });
}

/**
 * Ids in a plan are strings. Most collections here key on ObjectId, some on
 * plain strings, so try both rather than guessing per collection.
 */
function idCandidates(id: string): unknown[] {
  const candidates: unknown[] = [id];
  if (ObjectId.isValid(id) && new ObjectId(id).toString() === id) candidates.push(new ObjectId(id));
  return candidates;
}

export interface SnapshotSummary {
  runId: string;
  backupCount: number;
  /** Ids the plan named that no longer exist. Non-empty means the plan is stale. */
  missing: Array<{ collection: string; docId: string }>;
}

/**
 * Copy every touched document into healBackups, then read the copies back.
 * Throws if the readback count disagrees — better to refuse the heal than to
 * mutate prod with a rollback path we have not proven exists.
 */
export async function snapshot(
  db: Db,
  args: { runId: string; defectId: string; touched: TouchedDocs[]; now: Date }
): Promise<SnapshotSummary> {
  const rows: HealBackup[] = [];
  const missing: SnapshotSummary["missing"] = [];

  for (const entry of args.touched) {
    for (const docId of entry.ids) {
      const doc = await db
        .collection(entry.collection)
        .findOne({ _id: { $in: idCandidates(docId) } } as Record<string, unknown>);
      if (!doc) {
        missing.push({ collection: entry.collection, docId });
        continue;
      }
      rows.push({
        runId: args.runId,
        defectId: args.defectId,
        collection: entry.collection,
        docId,
        doc: doc as Record<string, unknown>,
        createdAt: args.now,
      });
    }
  }

  if (rows.length > 0) {
    await db.collection<HealBackup>(HEAL_BACKUPS_COLLECTION).insertMany(rows, { ordered: true });
  }

  const readBack = await db
    .collection<HealBackup>(HEAL_BACKUPS_COLLECTION)
    .countDocuments({ runId: args.runId });
  if (readBack !== rows.length) {
    throw new Error(
      `[remediation] snapshot readback mismatch for run ${args.runId}: wrote ${rows.length}, read ${readBack}. ` +
        "Refusing to heal without a proven rollback path."
    );
  }

  return { runId: args.runId, backupCount: rows.length, missing };
}

export interface RollbackSummary {
  runId: string;
  restored: number;
  deleted: number;
  notes: string[];
}

/**
 * Restore a run. Snapshotted documents are put back verbatim; documents the
 * heal INSERTED are deleted, but only those the result declared in
 * `insertedIds` — nothing else can know they exist.
 */
export async function rollback(
  db: Db,
  args: { runId: string; result?: HealResult }
): Promise<RollbackSummary> {
  const backups = await db
    .collection<HealBackup>(HEAL_BACKUPS_COLLECTION)
    .find({ runId: args.runId })
    .toArray();

  const notes: string[] = [];
  let restored = 0;
  for (const backup of backups) {
    await db
      .collection(backup.collection)
      .replaceOne({ _id: backup.doc._id } as Record<string, unknown>, backup.doc, { upsert: true });
    restored += 1;
  }

  let deleted = 0;
  for (const entry of args.result?.insertedIds ?? []) {
    for (const docId of entry.ids) {
      const res = await db
        .collection(entry.collection)
        .deleteOne({ _id: { $in: idCandidates(docId) } } as Record<string, unknown>);
      deleted += res.deletedCount;
    }
  }

  if (backups.length === 0) {
    notes.push(
      "no snapshot rows for this run — either it never reached the write stage, or it was already rolled back"
    );
  }
  if (!args.result?.insertedIds && (args.result?.documentsInserted ?? 0) > 0) {
    notes.push(
      `run reported ${args.result?.documentsInserted} inserts but declared no insertedIds — those documents are STILL PRESENT and must be removed by hand`
    );
  }

  return { runId: args.runId, restored, deleted, notes };
}
