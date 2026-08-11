/**
 * Cash-cost model for unlocking tech nodes (v2). Each unlock costs rdScore
 * (node.cost) AND cash = a fraction of the corp's daily gross revenue, so bigger
 * corps pay proportionally more. Cash is charged in the corp's local currency
 * (sector revenue is already local post-v0.2.6).
 */
import type { TechTreeNode } from "./nodes";

/** Default cash cost as a fraction of daily gross revenue, unless a node overrides. */
export const TECH_NODE_CASH_REVENUE_FRACTION = 0.25;

/**
 * Cash cost (local currency) to unlock `node` given the corp's daily gross
 * revenue. Rounded; never negative. Zero-revenue corps pay nothing in cash
 * (rdScore still applies).
 */
export function techNodeCashCost(node: TechTreeNode, dailyGrossRevenueLocal: number): number {
  const fraction = node.cashRevenueFraction ?? TECH_NODE_CASH_REVENUE_FRACTION;
  return Math.max(0, Math.round(dailyGrossRevenueLocal * fraction));
}
