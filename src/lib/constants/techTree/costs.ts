/**
 * Where tech unlock prices come from. Unlocking a node costs its rdScore price
 * plus cash equal to 15% of the corp's daily gross revenue
 * (TECH_NODE_CASH_REVENUE_FRACTION, techNodeCashCost), charged in the corp's
 * local currency, so bigger corps pay more. An era-scaled floor
 * (TECH_NODE_CASH_FLOOR_ANCHOR) stops small and zero-revenue corps paying
 * little or nothing.
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
import { ERA_PRICE_LEVEL } from "@/lib/campaigns/rules/priceLevel";

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
 * Minimum cash cost per node, in ₳ at the 2019 price level. Scaled by the game
 * year's price level (techPriceLevelForYear) so it stays proportionate in
 * every era: about 0.18M in 1953, 5M in 2019, 6.4M in 2027.
 *
 * Without a floor a corp with no revenue paid nothing but rdScore for a node,
 * and a tiny corp paid next to nothing (ticket #1506).
 */
export const TECH_NODE_CASH_FLOOR_ANCHOR = 5_000_000;

const PRICE_LEVEL_POINTS: ReadonlyArray<readonly [number, number]> = Object.entries(ERA_PRICE_LEVEL)
  .map(([year, level]) => [Number(year), level] as const)
  .sort((a, b) => a[0] - b[0]);

/**
 * Price level for a game year, linearly interpolated between the authored era
 * anchors (2019 = 1) and clamped to the first and last anchor.
 */
export function techPriceLevelForYear(year: number): number {
  const pts = PRICE_LEVEL_POINTS;
  if (!Number.isFinite(year)) return 1;
  if (year <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (year >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i++) {
    const [y1, l1] = pts[i];
    if (year <= y1) {
      const [y0, l0] = pts[i - 1];
      return l0 + ((l1 - l0) * (year - y0)) / (y1 - y0);
    }
  }
  return last[1];
}

/** Era-scaled cash floor per node in ₳; convert to the corp's currency before use. */
export function techNodeCashFloorAnchor(year: number): number {
  return TECH_NODE_CASH_FLOOR_ANCHOR * techPriceLevelForYear(year);
}

/**
 * Cash cost (local currency) to unlock `node`: the larger of a fraction of the
 * corp's daily gross revenue and the era-scaled floor (already converted into
 * the corp's currency). Rounded; never negative. rdScore applies on top.
 */
export function techNodeCashCost(
  node: TechTreeNode,
  dailyGrossRevenueLocal: number,
  cashFloorLocal = 0
): number {
  const fraction = node.cashRevenueFraction ?? TECH_NODE_CASH_REVENUE_FRACTION;
  const revenueShare = Math.round(
    (Number.isFinite(dailyGrossRevenueLocal) ? dailyGrossRevenueLocal : 0) * fraction
  );
  const floor = Number.isFinite(cashFloorLocal) ? Math.round(cashFloorLocal) : 0;
  return Math.max(0, revenueShare, floor);
}
