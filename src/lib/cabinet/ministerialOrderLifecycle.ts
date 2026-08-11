import type { Db } from "mongodb";
import type { MinisterialOrder } from "@/lib/db/types/ministerialOrder";
import { DEFAULT_ORDER_DURATION } from "@/lib/constants/cabinetMechanicsTypes";
import { getMinisterialOrdersCollection } from "@/lib/db/collections/cabinetSettings";

/** First turn on which the order is inactive (exclusive end of the active window). */
export function computeMinisterialOrderExpiresTurn(
  issuedTurn: number,
  duration: number = DEFAULT_ORDER_DURATION
): number {
  return issuedTurn + duration;
}

type OrderExpiryFields = Pick<MinisterialOrder, "expiresTurn" | "issuedTurn" | "duration">;

/** Resolve the expiry turn from persisted fields, coercing legacy/wrong-typed values. */
export function resolveMinisterialOrderExpiresTurn(order: OrderExpiryFields): number {
  if (order.duration != null && Number.isFinite(order.duration) && order.issuedTurn != null) {
    return computeMinisterialOrderExpiresTurn(order.issuedTurn, order.duration);
  }
  const coerced = Number(order.expiresTurn);
  if (Number.isFinite(coerced)) return coerced;
  return computeMinisterialOrderExpiresTurn(order.issuedTurn, DEFAULT_ORDER_DURATION);
}

export function isMinisterialOrderActive(
  order: Pick<MinisterialOrder, "active" | "expiresTurn" | "issuedTurn" | "duration">,
  currentTurn: number
): boolean {
  if (!order.active) return false;
  return resolveMinisterialOrderExpiresTurn(order) > currentTurn;
}

/**
 * Deactivate ministerial orders whose expiry turn has passed.
 *
 * Uses a typed query first, then sweeps any remaining `active: true` docs so
 * legacy rows with missing or string-typed `expiresTurn` cannot linger forever
 * (bug #0761).
 */
export async function expireMinisterialOrders(
  db: Db,
  currentTurn: number
): Promise<{ expired: number }> {
  const ordersCol = getMinisterialOrdersCollection(db);

  const fastPath = await ordersCol.updateMany(
    { active: true, expiresTurn: { $lte: currentTurn } },
    { $set: { active: false } }
  );

  const stillActive = await ordersCol
    .find({ active: true })
    .project<Pick<MinisterialOrder, "_id" | "expiresTurn" | "issuedTurn" | "duration">>({
      _id: 1,
      expiresTurn: 1,
      issuedTurn: 1,
      duration: 1,
    })
    .toArray();

  const staleIds = stillActive
    .filter((order) => resolveMinisterialOrderExpiresTurn(order) <= currentTurn)
    .map((order) => order._id);

  let sweepExpired = 0;
  if (staleIds.length > 0) {
    const sweep = await ordersCol.updateMany(
      { _id: { $in: staleIds } },
      { $set: { active: false } }
    );
    sweepExpired = sweep.modifiedCount;
  }

  return { expired: fastPath.modifiedCount + sweepExpired };
}
