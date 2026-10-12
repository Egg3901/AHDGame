/**
 * Where tech unlock prices come from. Unlocking a node costs its rdScore price
 * plus cash equal to 15% of the corp's daily gross revenue
 * (TECH_NODE_CASH_REVENUE_FRACTION, techNodeCashCost), charged in the corp's
 * local currency, so bigger corps pay more. A minimum cash price
 * (TECH_NODE_CASH_FLOOR_ANCHOR, scaled to the world era) stops tiny and
 * zero-revenue corps from unlocking nodes for R&D points alone (ticket #1506).
 */
/**
 * Cash-cost model for unlocking tech nodes (v2). Each unlock costs rdScore
 * (node.cost) AND cash = a fraction of the corp's daily gross revenue, so bigger
 * corps pay proportionally more. Cash is charged in the corp's local currency.
 *
 * The gross this multiplies is currency-converted before it is summed, see
 * `corpDailyGrossRevenueLocal`. Sector revenue is stored per host currency, so
 * a plain sum used to add yen to dollars and inflated the price of every node
 * for any corp holding a foreign sector (ticket #1118).
 */
import type { TechTreeNode } from "./nodes";

/**
 * Default cash cost as a fraction of daily gross revenue, unless a node
 * overrides it.
 *
 * Lowered from 0.25 to 0.15 alongside the ticket #1118 currency fix. A quarter
 * of daily gross put a single node at roughly a full day of a corp's profit,
 * which read as a wall rather than a decision once the inflated figure was no
 * longer masking how steep it was.
 */
export const TECH_NODE_CASH_REVENUE_FRACTION = 0.15;

/**
 * Minimum cash price of a tech node in 2019 anchor money, before era scaling.
 * Ticket #1506: pricing purely off revenue let a corp with no revenue unlock
 * nodes for R&D points alone. The floor is multiplied by the world's era unit
 * scale (2019 = 1.0) and converted into the corp's currency, so it is about
 * 5M in 2019, a fraction of that in the 1950s and a little more in the 2020s.
 * Large corps already pay far more than this and are unaffected.
 */
export const TECH_NODE_CASH_FLOOR_ANCHOR = 5_000_000;

/** Era-scaled floor in anchor money. Bad scales fall back to 2019 (1.0). */
export function techNodeCashFloorAnchor(eraUnitScale: number): number {
  const scale = Number.isFinite(eraUnitScale) && eraUnitScale > 0 ? eraUnitScale : 1;
  return TECH_NODE_CASH_FLOOR_ANCHOR * scale;
}

/**
 * Cash cost (local currency) to unlock `node`: the larger of the revenue
 * fraction of daily gross and `cashFloorLocal` (the era-scaled minimum already
 * converted into the corp's currency). Rounded; never negative. rdScore is
 * charged separately.
 */
export function techNodeCashCost(
  node: TechTreeNode,
  dailyGrossRevenueLocal: number,
  cashFloorLocal = 0
): number {
  const fraction = node.cashRevenueFraction ?? TECH_NODE_CASH_REVENUE_FRACTION;
  const revenueCost = Math.max(0, dailyGrossRevenueLocal * fraction);
  const floor = Number.isFinite(cashFloorLocal) ? Math.max(0, cashFloorLocal) : 0;
  return Math.round(Math.max(revenueCost, floor));
}
