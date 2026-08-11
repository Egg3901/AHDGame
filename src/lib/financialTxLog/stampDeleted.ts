import type { Db, ObjectId } from "mongodb";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { computeExpiresAt } from "@/lib/financialTxLog/expiresAt";

/**
 * Stamp `subjectDeletedAt` / `counterpartyDeletedAt` on every tx row that
 * references the entity, then extend `expiresAt` so the row survives the
 * full 168-turn forensic window from event time.
 *
 * Usage: call this immediately before deleting a character / corporation /
 * party / imperial character. Tx history is the source of truth for admin
 * audit; cascade deletion would erase forensic trails.
 *
 * Why two-step (stamp + extend): a freshly-emitted tx that's about to fall
 * out of the 168-turn window would still drop after deletion. Re-pinning
 * expiresAt to the deletion moment guarantees admins have at least a full
 * turn-window after the entity is gone to investigate.
 *
 * Pre-Phase-4 deletion paths cascade-deleted no tx rows (because nothing
 * called this), but they ALSO didn't stamp anything — the rows just
 * orphaned. This helper makes the orphan state explicit and queryable.
 */
export async function stampSubjectDeleted(
  db: Db,
  entityId: ObjectId,
  options: { sequentialId?: number; deletedAt?: Date } = {}
): Promise<void> {
  const deletedAt = options.deletedAt ?? new Date();
  const newExpiresAt = await computeExpiresAt(db, deletedAt);

  // Two updateMany calls because the field name differs based on which side
  // of the tx the entity sat on. Pre-Phase-4 a single $or would have
  // collapsed both into one deletedAt timestamp on rows where the entity
  // appears as both subject AND counterparty (rare but possible — e.g.,
  // self-issuance + same-corp dividend in same row).
  const subjectSet: Record<string, unknown> = { subjectDeletedAt: deletedAt };
  const counterpartySet: Record<string, unknown> = { counterpartyDeletedAt: deletedAt };
  if (options.sequentialId !== undefined) {
    subjectSet.subjectSequentialId = options.sequentialId;
    counterpartySet.counterpartySequentialId = options.sequentialId;
  }

  await db.collection<FinancialTxLogEntry>("financialTxLog").updateMany(
    {
      subjectId: entityId,
      // Don't overwrite an already-stamped deletion — first stamp wins so
      // forensic timestamps stay stable across re-imports or replays.
      subjectDeletedAt: { $exists: false },
    },
    {
      $set: subjectSet,
      // $max keeps the longer of (existing expiresAt, new expiresAt) so a
      // tx that's still inside its original window doesn't get shortened.
      $max: { expiresAt: newExpiresAt },
    }
  );

  await db.collection<FinancialTxLogEntry>("financialTxLog").updateMany(
    {
      counterpartyId: entityId,
      counterpartyDeletedAt: { $exists: false },
    },
    {
      $set: counterpartySet,
      $max: { expiresAt: newExpiresAt },
    }
  );
}
