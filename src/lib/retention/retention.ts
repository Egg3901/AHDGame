/**
 * Retention orchestrator: archive old history rows to R2, then delete or
 * downsample them per {@link RETENTION_POLICIES}.
 *
 * Safety invariants:
 *  - DRY-RUN by default: returns a manifest and performs NO writes.
 *  - Execution never deletes unless R2 is configured — we only remove rows we
 *    have successfully archived (recoverable).
 *  - GUARD rows (each corp's latest / each character's earliest) are excluded
 *    from both archive and delete, so derived balances/cost-basis stay intact.
 */
import type { Db, Document } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isR2Enabled } from "@/lib/r2";
import { archiveDocs } from "./archive";
import {
  RETENTION_POLICIES,
  RetentionMode,
  DEFAULT_KEEP_EVERY_K,
  type RetentionPolicy,
} from "./policy";

const MS_PER_TURN = 3600_000; // turns are hourly

export interface CollectionResult {
  collection: string;
  mode: RetentionMode;
  cutoff: number;
  matchCount: number;
  guardProtectedCount: number;
  wouldArchive: number;
  wouldDelete: number;
  wouldKeep: number;
  archivedCount?: number;
  deletedCount?: number;
  archiveKeys?: string[];
  compacted?: boolean;
  error?: string;
}

export interface RetentionSummary {
  dryRun: boolean;
  currentTurn: number;
  r2Enabled: boolean;
  results: CollectionResult[];
}

/** Build the "older than the window" match filter for a policy. */
function oldFilter(policy: RetentionPolicy, cutoff: number, now: number): Document {
  const base: Document = { [policy.timeKey]: { $lt: cutoff } };
  if (!policy.createdAtFallback) return base;
  const fallbackField = policy.createdAtFallback === true ? "createdAt" : policy.createdAtFallback;
  const cutoffDate = new Date(now - policy.windowTurns * MS_PER_TURN);
  return {
    $or: [
      base,
      {
        $and: [
          { $or: [{ [policy.timeKey]: null }, { [policy.timeKey]: { $exists: false } }] },
          { [fallbackField]: { $lt: cutoffDate } },
        ],
      },
    ],
  };
}

/** _ids of the per-group guard rows that must never be removed. */
async function guardIds(db: Db, policy: RetentionPolicy): Promise<unknown[]> {
  if (!policy.guard) return [];
  const dir = policy.guard.kind === "MAX_PER_GROUP" ? -1 : 1;
  const rows = await db
    .collection(policy.collection)
    .aggregate(
      [
        { $match: { [policy.timeKey]: { $ne: null } } },
        { $sort: { [policy.timeKey]: dir } },
        { $group: { _id: `$${policy.guard.groupField}`, keepId: { $first: "$_id" } } },
      ],
      { allowDiskUse: true }
    )
    .toArray();
  return rows.map((r) => (r as { keepId: unknown }).keepId).filter((id) => id != null);
}

/** The exact filter of rows to DELETE for this policy (never includes guards). */
function deleteFilter(
  policy: RetentionPolicy,
  base: Document,
  cutoff: number,
  guards: unknown[]
): Document {
  switch (policy.mode) {
    case RetentionMode.ARCHIVE_DELETE:
      return base;
    case RetentionMode.ARCHIVE_DELETE_GUARD:
      return { $and: [base, { _id: { $nin: guards } }] };
    case RetentionMode.DOWNSAMPLE: {
      const k = policy.keepEveryK ?? DEFAULT_KEEP_EVERY_K;
      // Keep rows whose turn is congruent to the cutoff mod K (~1/K kept);
      // delete the rest of the old rows.
      return {
        $and: [base, { $expr: { $ne: [{ $mod: [`$${policy.timeKey}`, k] }, cutoff % k] } }],
      };
    }
    case RetentionMode.ARCHIVE_ONLY_NO_DELETE:
      return { _id: { $exists: false } }; // matches nothing
  }
}

export async function runRetention(
  opts: { dryRun?: boolean; collections?: string[]; compact?: boolean } = {}
): Promise<RetentionSummary> {
  const dryRun = opts.dryRun ?? true;
  const db = await getDb();
  const now = Date.now();

  const gs = (await db.collection("gameState").findOne({ _id: "current" as never })) as {
    currentTurn?: number;
    turn?: number;
  } | null;
  const currentTurn = gs?.currentTurn ?? gs?.turn ?? 0;
  const r2Enabled = isR2Enabled();

  const policies = RETENTION_POLICIES.filter(
    (p) => !opts.collections || opts.collections.includes(p.collection)
  );

  const results: CollectionResult[] = [];
  for (const policy of policies) {
    const cutoff = currentTurn - policy.windowTurns;
    const res: CollectionResult = {
      collection: policy.collection,
      mode: policy.mode,
      cutoff,
      matchCount: 0,
      guardProtectedCount: 0,
      wouldArchive: 0,
      wouldDelete: 0,
      wouldKeep: 0,
    };
    try {
      const col = db.collection(policy.collection);
      const base = oldFilter(policy, cutoff, now);
      const matchCount = await col.countDocuments(base);
      res.matchCount = matchCount;

      const guards = policy.guard ? await guardIds(db, policy) : [];
      const del = deleteFilter(policy, base, cutoff, guards);
      const wouldDelete =
        policy.mode === RetentionMode.ARCHIVE_ONLY_NO_DELETE ? 0 : await col.countDocuments(del);

      // For downsample we archive the FULL old window (full granular preserved);
      // otherwise the archived set is exactly the deleted set.
      const wouldArchive =
        policy.mode === RetentionMode.DOWNSAMPLE ||
        policy.mode === RetentionMode.ARCHIVE_ONLY_NO_DELETE
          ? matchCount
          : wouldDelete;

      res.wouldDelete = wouldDelete;
      res.wouldArchive = wouldArchive;
      res.wouldKeep = matchCount - wouldDelete;
      res.guardProtectedCount = policy.guard ? matchCount - wouldDelete : 0;

      if (dryRun) {
        results.push(res);
        continue;
      }

      if (!r2Enabled) {
        res.error = "R2 not configured — refusing to delete without an archive";
        results.push(res);
        continue;
      }

      const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
      const archiveSet =
        policy.mode === RetentionMode.DOWNSAMPLE ||
        policy.mode === RetentionMode.ARCHIVE_ONLY_NO_DELETE
          ? base
          : del;
      const archived = await archiveDocs({
        db,
        dbName: db.databaseName,
        collection: policy.collection,
        filter: archiveSet,
        cutoff,
        stamp,
      });
      res.archivedCount = archived.archivedCount;
      res.archiveKeys = archived.keys;

      if (policy.mode !== RetentionMode.ARCHIVE_ONLY_NO_DELETE) {
        const dr = await col.deleteMany(del);
        res.deletedCount = dr.deletedCount ?? 0;
        if (opts.compact) {
          await db.command({ compact: policy.collection }).catch(() => {});
          res.compacted = true;
        }
      }
    } catch (err) {
      res.error = err instanceof Error ? err.message : String(err);
    }
    results.push(res);
  }

  return { dryRun, currentTurn, r2Enabled, results };
}
