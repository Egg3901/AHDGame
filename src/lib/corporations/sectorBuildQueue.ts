/**
 * Build-queue presentation summary (plants tier).
 *
 * A sector's `buildQueue` is an array of orders, each with its own delivery
 * turn. Every surface that shows a sector in a LIST (the sectors table, the CEO
 * build summary, the untapped-market card) needs the same one-line answer:
 * how much capacity is on the way, and when does the next of it land.
 *
 * Doing that inline three times produced three different answers on the first
 * pass — one summed `unitsOrdered` over the whole queue, one showed only the
 * head order, one showed the LAST `onlineTurn` instead of the soonest. So it
 * lives here, once, as a pure function.
 */

import type { SectorBuildOrder } from "@/lib/db/types";
import { undeliveredUnits } from "@/lib/corporations/buildDelivery";

export interface BuildQueueSummary {
  /** Number of outstanding orders. */
  orders: number;
  /** Total capacity units on order across the whole queue (output units/day). */
  unitsOrdered: number;
  /**
   * Capacity units still UNDER construction (not yet delivered) across the
   * queue. Equals `unitsOrdered` for legacy all-at-once orders; for smooth
   * orders it is the not-yet-built remainder, which falls a slice per turn.
   */
  unitsRemaining: number;
  /** Turn the SOONEST outstanding order lands. Null when the queue is empty. */
  nextOnlineTurn: number | null;
  /**
   * Turns until `nextOnlineTurn`, floored at 0. Null when the queue is empty.
   * Floored rather than allowed negative: an order whose turn has passed but
   * which the turn processor has not yet converted reads as "landing now", not
   * as a negative countdown.
   */
  turnsRemaining: number | null;
}

/**
 * Summarize a sector's outstanding build orders as of `currentTurn`.
 *
 * Returns null for an absent or empty queue, so callers can render nothing
 * without also having to check `orders === 0` — "no builds under way" is the
 * common case and should not need a second test at every call site.
 */
export function summarizeBuildQueue(
  queue: SectorBuildOrder[] | null | undefined,
  currentTurn: number
): BuildQueueSummary | null {
  if (!Array.isArray(queue) || queue.length === 0) return null;

  let unitsOrdered = 0;
  let unitsRemaining = 0;
  let nextOnlineTurn: number | null = null;
  for (const order of queue) {
    const units = Number.isFinite(order?.unitsOrdered) ? order.unitsOrdered : 0;
    if (units > 0) {
      unitsOrdered += units;
      unitsRemaining += undeliveredUnits(order, currentTurn);
    }
    const online = order?.onlineTurn;
    if (Number.isFinite(online) && (nextOnlineTurn == null || online < nextOnlineTurn)) {
      nextOnlineTurn = online;
    }
  }

  return {
    orders: queue.length,
    unitsOrdered,
    unitsRemaining,
    nextOnlineTurn,
    turnsRemaining: nextOnlineTurn == null ? null : Math.max(0, nextOnlineTurn - currentTurn),
  };
}
