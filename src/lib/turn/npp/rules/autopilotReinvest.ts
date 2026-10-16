/**
 * Reinvestment rules for corporations a player has put on autopilot.
 *
 * An NPP corp sizes growth for a board that wants to expand. A hands-off owner
 * wants the opposite: small steps, only where the plant already earns its
 * keep. Plain data in, plain data out; the shell in makeCorpDecision loads the
 * sector facts and applies the verdicts.
 */

/** Largest share of a sector's running capacity one autopilot growth step may add. */
export const AUTOPILOT_GROWTH_STEP_OF_RUN = 0.05;

/**
 * Growth steps that may be in flight in one sector at once. One means a new
 * growth order waits until the previous one has landed.
 */
export const AUTOPILOT_MAX_INFLIGHT_GROWTH_STEPS = 1;

/** Share of cash above the cash floor autopilot may commit to new capacity in one turn. */
export const AUTOPILOT_CAPEX_CASH_SHARE = 0.15;

/**
 * Growth orders are sized against this share of the capex budget, leaving room
 * for the replacement leg and price differences so the sized order still fits
 * under the ceiling when it is priced.
 */
export const AUTOPILOT_CAPEX_SIZING_SLACK = 0.9;

/**
 * Turns after a build comes online in which its extra profit must repay its
 * cost, at the sector's current profit per unit of operating capacity.
 */
export const AUTOPILOT_PAYBACK_HORIZON_TURNS = 30;

export type AutopilotGrowthGate =
  "autopilot_unprofitable" | "autopilot_no_payback" | "autopilot_demand_headroom";

export interface AutopilotGrowthFacts {
  /** Last turn's sector profit, in the corporation's currency. */
  sectorProfitLocal: number;
  /** Capacity the sector actually operates (units). */
  operatingCapacityUnits: number;
  /** The corporation's trailing net earnings after overhead and debt service. */
  corpEarningsLocal: number;
  /** Growth units sized for the order. */
  growthUnits: number;
  /** Estimated cost of those growth units, in the corporation's currency. */
  growthCostLocal: number;
  /** Market room left for this sector (units). */
  demandHeadroomUnits: number;
}

/** Estimated extra profit per turn for one more unit of operating capacity. */
export function autopilotProfitPerUnit(
  sectorProfitLocal: number,
  operatingCapacityUnits: number
): number {
  if (!(sectorProfitLocal > 0) || !(operatingCapacityUnits > 0)) return 0;
  return sectorProfitLocal / operatingCapacityUnits;
}

/** First gate that stops an autopilot growth leg, or null when it may proceed. */
export function evaluateAutopilotGrowthGate(
  facts: AutopilotGrowthFacts
): AutopilotGrowthGate | null {
  const perUnit = autopilotProfitPerUnit(facts.sectorProfitLocal, facts.operatingCapacityUnits);
  if (!(perUnit > 0) || !(facts.corpEarningsLocal > 0)) return "autopilot_unprofitable";
  if (!(facts.demandHeadroomUnits >= 1)) return "autopilot_demand_headroom";
  if (!(facts.growthUnits > 0)) return null;
  const recovered = perUnit * facts.growthUnits * AUTOPILOT_PAYBACK_HORIZON_TURNS;
  if (!(recovered >= facts.growthCostLocal)) return "autopilot_no_payback";
  return null;
}

/** Growth units after the demand headroom bound. */
export function autopilotBoundGrowthUnits(
  growthUnits: number,
  demandHeadroomUnits: number
): number {
  if (!Number.isFinite(growthUnits) || !Number.isFinite(demandHeadroomUnits)) return 0;
  return Math.max(0, Math.floor(Math.min(growthUnits, demandHeadroomUnits)));
}

/** Cash autopilot may commit to new capacity this turn. */
export function autopilotCapexBudgetLocal(cashLocal: number, cashFloorLocal: number): number {
  return Math.max(0, cashLocal - cashFloorLocal) * AUTOPILOT_CAPEX_CASH_SHARE;
}
