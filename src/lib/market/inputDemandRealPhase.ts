import type { GameConfig } from "@/lib/db/types";

/**
 * Input demand follows real output, not the price level.
 *
 * A sector's input demand is `revenue x recipe rate / base price`. Revenue is
 * nominal and carries the sector's realized price premium (clearing factor
 * over sold fraction: scarcity memory, market balance, the nominal index), so
 * a short market raised its buyers' revenue, which raised their input demand,
 * which deepened the shortages upstream. Over this many turns the revenue that
 * drives input demand is divided by the sector's own price leg, so demand
 * tracks the volume a sector actually makes.
 *
 * Plants worlds are exempt (`effectiveInputDemandRealPhase`): their persisted
 * revenue is a base-priced capacity nameplate already scaled by utilization,
 * so it carries no price leg to remove.
 */
export const INPUT_DEMAND_REAL_PHASE_TURNS = 24;

/** Price legs outside this band are treated as noise (thin or one-off sales). */
export const INPUT_DEMAND_PRICE_LEG_MIN = 0.5;
export const INPUT_DEMAND_PRICE_LEG_MAX = 4;

/** Progress in [0, 1] through the phase-in; 0 before it starts. */
export function inputDemandRealPhaseProgress(
  startTurn: number | undefined | null,
  currentTurn: number | undefined | null
): number {
  if (startTurn == null || currentTurn == null) return 0;
  return Math.max(0, Math.min(1, (currentTurn - startTurn) / INPUT_DEMAND_REAL_PHASE_TURNS));
}

/**
 * Last turn's realized price leg for a sector: clearing factor over sold
 * fraction (price x posture). Null when either is missing or not positive.
 */
export function sectorPriceLeg(
  clearingFactor: number | undefined | null,
  soldFraction: number | undefined | null
): number | null {
  if (typeof clearingFactor !== "number" || typeof soldFraction !== "number") return null;
  if (!Number.isFinite(clearingFactor) || !Number.isFinite(soldFraction)) return null;
  if (clearingFactor <= 0 || soldFraction <= 0) return null;
  return clearingFactor / soldFraction;
}

/**
 * Phase progress that actually applies to a world's input-demand leg.
 *
 * The deflator exists for worlds whose `sector.revenue` is the compounding
 * revenue anchor, which can carry realized price legs. Under plants it is
 * not: the persisted revenue is the capacity nameplate, owned capacity times
 * the BASE-price mix price (`plantsNameplateRevenue`), and the ledger already
 * scales it by utilization. That product is exactly the producedUnits x recipe
 * quantity the plant is billed for (`computeInputsCost`). Dividing it by the
 * price leg removed real input demand the plants still bought, so world
 * demand fell below what consumers took and markets read a surplus that did
 * not exist. Plants worlds therefore never deflate.
 */
export function effectiveInputDemandRealPhase(
  progress: number | undefined | null,
  plantsEnabled: boolean
): number {
  if (plantsEnabled) return 0;
  return typeof progress === "number" && Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0;
}

/**
 * Divisor applied to a sector's revenue before it drives input demand:
 * 1 before the phase starts, the clamped price leg once it completes.
 */
export function inputDemandDeflator(priceLeg: number | null | undefined, progress: number): number {
  if (typeof priceLeg !== "number" || !Number.isFinite(priceLeg)) return 1;
  const leg = Math.max(INPUT_DEMAND_PRICE_LEG_MIN, Math.min(INPUT_DEMAND_PRICE_LEG_MAX, priceLeg));
  const phase = Math.max(0, Math.min(1, progress));
  return 1 + phase * (leg - 1);
}

/**
 * Start turn of the phase-in for this world: `gameConfig.inputDemandRealPhaseStartTurn`
 * as set by an operator. Not stamped automatically on deploy. Absent = no phase.
 */
export function inputDemandRealPhaseStartTurnFrom(
  config: Pick<GameConfig, "inputDemandRealPhaseStartTurn"> | null | undefined
): number | undefined {
  const start = config?.inputDemandRealPhaseStartTurn;
  return typeof start === "number" && Number.isFinite(start) ? start : undefined;
}
