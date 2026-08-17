/**
 * Shared D9 retool rescale: capital stock, in-flight build queue, and the
 * calibrated physical-opex anchor.
 *
 * The player command (`setSectorStrategy`) has always moved all three so that
 * nameplate stays put while `anchor × units` (the actual ₳ charged) stays
 * put. Automated retool paths used to rescale stock and queue only, which
 * multiplied residual operating cost by the RPU ratio (up to 327x on a
 * coal/rare-earth pair) for no reason a player could name.
 *
 * One helper, every path.
 */

import type { CorporationType } from "@/lib/constants/corporations";
import {
  capacityRescaleRatio,
  rescaleBuildQueueForStrategyChange,
} from "@/lib/constants/capacityEconomy";
import { rescaleOtherOpexAnchorForRetool } from "@/lib/corporations/physicalPnl";
import type { SectorBuildOrder } from "@/lib/db/types";

export interface RetoolRescaleInput {
  sectorType: CorporationType;
  fromStrategyId: string | null | undefined;
  toStrategyId: string | null | undefined;
  plantsEnabled: boolean;
  capitalStock?: number;
  buildQueue?: SectorBuildOrder[];
  otherOpexPerUnitAnchor?: number;
}

export type RetoolRescaleSet = Partial<{
  capitalStock: number;
  buildQueue: SectorBuildOrder[];
  otherOpexPerUnitAnchor: number;
  retoolRescaleApplied: boolean;
}>;

/**
 * `$set` fragment for a strategy switch. Empty of capacity/opex legs when
 * plants is off (the RPU basis does not apply); always records
 * `retoolRescaleApplied` so a later cancel knows whether to invert.
 */
export function retoolRescaleFields(input: RetoolRescaleInput): RetoolRescaleSet {
  if (!input.plantsEnabled) {
    return { retoolRescaleApplied: false };
  }
  const ratio = capacityRescaleRatio(input.sectorType, input.fromStrategyId, input.toStrategyId);
  const out: RetoolRescaleSet = { retoolRescaleApplied: true };
  if (typeof input.capitalStock === "number" && Number.isFinite(input.capitalStock)) {
    out.capitalStock = input.capitalStock * ratio;
  }
  if (Array.isArray(input.buildQueue) && input.buildQueue.length > 0) {
    out.buildQueue = rescaleBuildQueueForStrategyChange(input.buildQueue, ratio);
  }
  const opex = rescaleOtherOpexAnchorForRetool(input.otherOpexPerUnitAnchor, ratio);
  if (opex != null) out.otherOpexPerUnitAnchor = opex;
  return out;
}

/**
 * One-shot correction for in-flight auto-retoools that rescaled `capitalStock`
 * but left `otherOpexPerUnitAnchor` on the old unit basis.
 *
 * Discriminator: player `setSectorStrategy` always writes `retoolRescaleApplied`
 * (true or false). Auto paths historically omitted it. Combined with "this is
 * an auto retool" (NPP-run corp, or `autoStrategyAdoptedAtTurn` set; pass 1
 * can convert a player miner), that selects the corrupt in-flight rows without
 * touching a legacy player transition that predates the flag.
 *
 * Returns null when there is nothing to do. The caller stamps the returned
 * fields onto the sector update AND must use the healed anchor for this turn's
 * physical P&L, otherwise the turn still bills the unrebased residual.
 *
 * Does not mutate production data outside the normal sector-turn write.
 */
export function healAutoRetoolOpexAnchor(args: {
  plantsEnabled: boolean;
  isAutoRetool: boolean;
  transitionFromStrategyId?: string | null;
  strategyId?: string | null;
  sectorType: CorporationType;
  retoolRescaleApplied?: boolean;
  otherOpexPerUnitAnchor?: number;
}): { otherOpexPerUnitAnchor?: number; retoolRescaleApplied: true } | null {
  if (!args.plantsEnabled || !args.isAutoRetool) return null;
  if (!args.transitionFromStrategyId) return null;
  if (args.retoolRescaleApplied !== undefined) return null;
  const ratio = capacityRescaleRatio(
    args.sectorType,
    args.transitionFromStrategyId,
    args.strategyId
  );
  const opex = rescaleOtherOpexAnchorForRetool(args.otherOpexPerUnitAnchor, ratio);
  if (opex == null) return { retoolRescaleApplied: true };
  if (ratio === 1) return { retoolRescaleApplied: true };
  return { otherOpexPerUnitAnchor: opex, retoolRescaleApplied: true };
}
