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
 * Cash cost (local currency) to unlock `node` given the corp's daily gross
 * revenue. Rounded; never negative. Zero-revenue corps pay nothing in cash
 * (rdScore still applies).
 */
export function techNodeCashCost(node: TechTreeNode, dailyGrossRevenueLocal: number): number {
  const fraction = node.cashRevenueFraction ?? TECH_NODE_CASH_REVENUE_FRACTION;
  return Math.max(0, Math.round(dailyGrossRevenueLocal * fraction));
}
