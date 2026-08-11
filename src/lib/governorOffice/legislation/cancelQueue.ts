import type { Db, ObjectId } from "mongodb";
import type { Character, GovernorQueuedBill } from "@/lib/db/types";

/**
 * Cancel a pending queued bill. Always refunds the governor's prepaid action
 * points + NPI, even when the governor has since left office (refund routes
 * back to the original governorCharacterId on record).
 */
export async function cancelQueue(
  db: Db,
  queueId: ObjectId,
  reason: NonNullable<GovernorQueuedBill["cancelReason"]> = "manual"
): Promise<{ status: number; body: { success?: boolean; error?: string } }> {
  const doc = await db
    .collection<GovernorQueuedBill>("governorLegislationQueue")
    .findOne({ _id: queueId });
  if (!doc) return { status: 404, body: { error: "Queue entry not found." } };
  if (doc.status !== "pending") {
    return { status: 400, body: { error: `Queue entry already ${doc.status}.` } };
  }

  await db.collection<Character>("characters").updateOne(
    { _id: doc.governorCharacterId },
    {
      $inc: {
        actions: doc.proposalActionCost,
        ...(doc.proposalNpiCost > 0 ? { nationalInfluence: doc.proposalNpiCost } : {}),
      },
      $set: { updatedAt: new Date() },
    }
  );

  const newStatus = reason === "manual" ? "cancelled" : "auto_cancelled";
  const updated = await db.collection<GovernorQueuedBill>("governorLegislationQueue").updateOne(
    { _id: queueId, status: "pending" },
    {
      $set: {
        status: newStatus,
        cancelReason: reason,
        updatedAt: new Date(),
      },
    }
  );
  if (updated.modifiedCount === 0) {
    return { status: 409, body: { error: "Queue entry was modified concurrently." } };
  }
  return { status: 200, body: { success: true } };
}
