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
import { needsRetoolStockCatchup } from "@/lib/corporations/retooling/rules";
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
 * One-shot correction for in-flight auto-retools that rescaled `capitalStock`
 * but left `otherOpexPerUnitAnchor` on the old unit basis.
 *
 * Discriminator: player `setSectorStrategy` always writes `retoolRescaleApplied`
 * (true or false). Auto paths historically omitted it. Combined with "this is
 * an auto retool" (NPP-run corp, or `autoStrategyAdoptedAtTurn` set; pass 1
 * can convert a player miner), that selects the corrupt in-flight rows without
 * touching a legacy player transition that predates the flag.
 *
 * This heals the anchor ONLY. When the stock itself is still on the source
 * basis (a pre-rescale or pre-plants commitment surfaced under plants, issue
 * #2009), stamping the flag here without converting the stock lets the blend
 * ratio manufacture unsupported capacity. That case belongs to
 * `healRetoolStockBasis` below, which converts stock and anchor together.
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

export interface RetoolStockBasisHealInput {
  plantsEnabled: boolean;
  isAutoRetool: boolean;
  sectorType: CorporationType;
  strategyId?: string | null;
  transitionFromStrategyId?: string | null;
  transitionStartTurn?: number | null;
  plantsStartTurn?: number | null;
  retoolRescaleApplied?: boolean;
  capitalStock?: number;
  otherOpexPerUnitAnchor?: number;
}

export interface RetoolStockBasisHeal {
  capitalStock?: number;
  otherOpexPerUnitAnchor?: number;
  retoolRescaleApplied: true;
}

/**
 * One-shot basis correction for transitions whose owned stock was never
 * converted to the destination units (issue #2009): pre-rescale commitments,
 * and capital-mode commitments surfacing under plants, both of which carry
 * no (or an explicitly false) rescale flag.
 *
 * When `needsRetoolStockCatchup` fires, the stock is provably source-basis,
 * so it is converted here by the same RPU ratio the retool boundary would
 * have applied, and the per-unit opex anchor moves with it (anchor x units
 * stays fixed). The caller must run this turn's capacity advance off the
 * returned stock and stamp every returned leg, otherwise the blend ratio
 * keeps multiplying unconverted stock into unsupported operating capacity
 * (observed: 2,314.82 source units x ~390 blend = 903,166 operating units
 * on an oil_gas to rare_earth_mining retool, four turns in).
 *
 * When the transition was committed under plants without a flag (pre-flag
 * writers converted the stock but recorded nothing), the stock is already
 * converted and only the auto anchor heal is ever owed; non-auto rows are
 * left alone. The in-flight build queue is deliberately untouched: the turn
 * never `$set`s it (C4), and a stale-basis order lands once and dilutes
 * rather than compounding.
 *
 * Stock conversion is authorship-blind: basis is a physical fact, and a
 * player capital-mode retool flipped to plants mints exactly like an auto
 * one. The anchor-only fallback keeps the existing auto discriminator so a
 * legacy player transition that predates the flag is never reinterpreted.
 */
export function healRetoolStockBasis(
  input: RetoolStockBasisHealInput
): RetoolStockBasisHeal | null {
  if (!input.plantsEnabled || !input.transitionFromStrategyId) return null;
  if (input.retoolRescaleApplied === true) return null;
  if (
    !needsRetoolStockCatchup({
      transitionFromStrategyId: input.transitionFromStrategyId,
      retoolRescaleApplied: input.retoolRescaleApplied,
      transitionStartTurn: input.transitionStartTurn,
      plantsStartTurn: input.plantsStartTurn,
    })
  ) {
    if (!input.isAutoRetool) return null;
    const anchorHeal = healAutoRetoolOpexAnchor({
      plantsEnabled: input.plantsEnabled,
      isAutoRetool: input.isAutoRetool,
      transitionFromStrategyId: input.transitionFromStrategyId,
      strategyId: input.strategyId,
      sectorType: input.sectorType,
      retoolRescaleApplied: input.retoolRescaleApplied,
      otherOpexPerUnitAnchor: input.otherOpexPerUnitAnchor,
    });
    return anchorHeal;
  }
  const ratio = capacityRescaleRatio(
    input.sectorType,
    input.transitionFromStrategyId,
    input.strategyId
  );
  const out: RetoolStockBasisHeal = { retoolRescaleApplied: true };
  if (typeof input.capitalStock === "number" && Number.isFinite(input.capitalStock)) {
    out.capitalStock = input.capitalStock * ratio;
  }
  const opex = rescaleOtherOpexAnchorForRetool(input.otherOpexPerUnitAnchor, ratio);
  if (opex != null) out.otherOpexPerUnitAnchor = opex;
  return out;
}
