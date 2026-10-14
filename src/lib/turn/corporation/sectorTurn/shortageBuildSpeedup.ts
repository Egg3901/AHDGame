/**
 * Faster builds for plants whose output is in deep shortage.
 *
 * Construction is a pure function of an order's `startTurn`/`onlineTurn`
 * (see corporations/buildDelivery.ts). While `gameConfig.shortageBuildSpeedupEnabled`
 * is on, each outstanding order in a sector whose own output clears into a
 * market more than SHORTAGE_BUILD_UNMET_THRESHOLD unmet has its REMAINING
 * build time multiplied by SHORTAGE_BUILD_TIME_FACTOR, once per order. The
 * window is rewritten so the share already delivered at the current turn is
 * unchanged: no capacity or construction-in-progress jumps, the rest of the
 * order just arrives sooner. Covers orders placed before the switch and new
 * ones, through one engine path rather than every place an order is created.
 */
import type { CommodityType } from "@/lib/constants/commodities";
import type { SectorBuildOrder } from "@/lib/db/types";
import { deliveredFraction } from "@/lib/corporations/buildDelivery";

export const SHORTAGE_BUILD_UNMET_THRESHOLD = 0.25;
export const SHORTAGE_BUILD_TIME_FACTOR = 0.5;

/** Output-rate-weighted unmet share of the books a sector sells into, 0..1. */
export function sectorOutputUnmetShare(
  supplyRates: Partial<Record<CommodityType, number>> | null | undefined,
  balances: ReadonlyMap<CommodityType, { supply: number; demand: number }> | null | undefined
): number {
  if (!supplyRates || !balances) return 0;
  let rateSum = 0;
  let weighted = 0;
  for (const [commodity, rate] of Object.entries(supplyRates) as [CommodityType, number][]) {
    if (!(rate > 0)) continue;
    const bal = balances.get(commodity);
    const unmet = bal && bal.demand > 0 ? Math.max(0, bal.demand - bal.supply) / bal.demand : 0;
    rateSum += rate;
    weighted += rate * unmet;
  }
  return rateSum > 0 ? weighted / rateSum : 0;
}

/**
 * The accelerated window for one outstanding order, or null when it should
 * not change (already accelerated, already due, or degenerate). Keeps the
 * delivered fraction at `currentTurn` identical; the new `onlineTurn` is an
 * integer so the turn's `$pull` of landed orders still matches it.
 */
export function acceleratedBuildWindow(
  order: SectorBuildOrder,
  currentTurn: number,
  factor: number = SHORTAGE_BUILD_TIME_FACTOR
): { startTurn: number; onlineTurn: number } | null {
  if (order.accelerated === true) return null;
  const remaining = order.onlineTurn - currentTurn;
  if (!(remaining > 1)) return null;
  const onlineTurn = currentTurn + Math.max(1, Math.ceil(remaining * factor));
  if (!(onlineTurn < order.onlineTurn)) return null;
  if (order.smooth !== true || !(order.onlineTurn - order.startTurn > 0)) {
    // All-at-once order: nothing delivered yet, only the landing turn moves.
    return { startTurn: order.startTurn, onlineTurn };
  }
  const f = deliveredFraction(order, currentTurn);
  if (!(f < 1)) return null;
  // Solve (currentTurn - s') / (onlineTurn - s') = f for s'.
  const startTurn =
    f <= 0 ? Math.min(order.startTurn, currentTurn) : (currentTurn - f * onlineTurn) / (1 - f);
  return { startTurn, onlineTurn };
}

/**
 * One positional update per order to accelerate, matched by the order's
 * immutable identity so a concurrently placed order is never touched.
 */
export function shortageBuildSpeedupOps(args: {
  enabled: boolean;
  sectorId: unknown;
  outstanding: readonly SectorBuildOrder[];
  currentTurn: number;
  unmetShare: number;
  now: Date;
}): Array<{
  updateOne: {
    filter: Record<string, unknown>;
    update: { $set: Record<string, unknown> };
    arrayFilters: Record<string, unknown>[];
  };
}> {
  const { enabled, sectorId, outstanding, currentTurn, unmetShare, now } = args;
  if (!enabled || !(unmetShare > SHORTAGE_BUILD_UNMET_THRESHOLD)) return [];
  const ops = [];
  for (const order of outstanding) {
    const next = acceleratedBuildWindow(order, currentTurn);
    if (!next) continue;
    ops.push({
      updateOne: {
        filter: { _id: sectorId },
        update: {
          $set: {
            "buildQueue.$[o].startTurn": next.startTurn,
            "buildQueue.$[o].onlineTurn": next.onlineTurn,
            "buildQueue.$[o].accelerated": true,
            updatedAt: now,
          },
        },
        arrayFilters: [
          {
            "o.startTurn": order.startTurn,
            "o.onlineTurn": order.onlineTurn,
            "o.unitsOrdered": order.unitsOrdered,
            "o.accelerated": { $ne: true },
          },
        ],
      },
    });
  }
  return ops;
}
