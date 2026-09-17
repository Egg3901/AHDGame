import type { Db, ObjectId } from "mongodb";
import type { Corporation, ShareOrder } from "@/lib/db/types";
import {
  executeShareOrderRefundFlow,
  type ShareOrderRefundResult,
} from "@/lib/corporations/shareOrderRefund";

export type CancelResult = ShareOrderRefundResult;

/**
 * True when `actorCharacterId` may cancel this order: they authorized it, or
 * they are the sitting CEO of the corporation that placed it.
 */
export function actorMayCancelShareOrder(
  order: Pick<ShareOrder, "characterId" | "placerCorporationId">,
  actorCharacterId: ObjectId,
  placerCorp: Pick<Corporation, "ceoId" | "ceoVacant"> | null | undefined
): boolean {
  if (order.characterId?.equals(actorCharacterId)) return true;
  if (
    order.placerCorporationId &&
    placerCorp?.ceoId?.equals(actorCharacterId) &&
    placerCorp.ceoVacant !== true
  ) {
    return true;
  }
  return false;
}

/**
 * Cancel an open share order and refund the escrow / reserved shares.
 *
 * Used by:
 * - DELETE /api/corporations/[id]/shares/orders/[orderId] (player-initiated cancel)
 * - POST /api/corporations/[id]/shares/consolidate        (auto-cancel before restructure)
 *
 * Crash-safe keyed flow (issue #1672, see shareOrderRefund.ts): the CAS
 * claim, the pinned remainder plan, and the exactly-once refund/restore
 * legs converge on retry instead of stranding escrow on a cancelled order.
 * `opts.idempotencyKey` carries the client `Idempotency-Key` from the
 * route (a fresh key is minted per call when absent); key reuse across
 * different orders throws MoneyFlowKeyConflictError and reuse of a settled
 * key throws MoneyFlowTerminalError for the route to map to 409.
 */
export async function cancelShareOrderAndRefund(
  db: Db,
  order: ShareOrder,
  opts: { idempotencyKey?: string } = {}
): Promise<CancelResult> {
  return executeShareOrderRefundFlow(db, order, opts);
}
