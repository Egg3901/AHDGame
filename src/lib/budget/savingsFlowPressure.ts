/**
 * Normalises 12-turn savings ledger flows into a bounded pressure signal for inflation.
 *
 * Uses an "effective stock" denominator so tiny reported balances (or stale data) do not
 * blow up the ratio when gross deposit/withdraw activity is larger than the stock.
 */

/** Minimum denominator (local currency) — scales with macro game; avoids micro-noise. */
export const SAVINGS_STOCK_DENOMINATOR_FLOOR = 5_000_000;

/** Gross flow (deposits + withdrawals) contributes at least this fraction to the denominator. */
const GROSS_FLOW_DENOM_WEIGHT = 0.25;

/**
 * @param netFlow withdrawals minus deposits over the window (same currency as balance)
 * @param grossFlow deposits plus withdrawals (>= |netFlow|)
 * @param reportedStock point-in-time national savings total from central bank
 * @returns clamped ratio in [-1, 1] for inflation math; multiply by 100 for display as %
 */
export function savingsFlowPressureRatio(
  netFlow: number,
  grossFlow: number,
  reportedStock: number
): number {
  const churnFloor = grossFlow > 0 ? grossFlow * GROSS_FLOW_DENOM_WEIGHT : 0;
  const denom = Math.max(reportedStock, SAVINGS_STOCK_DENOMINATOR_FLOOR, churnFloor);
  if (denom <= 0) return 0;
  const raw = netFlow / denom;
  return Math.max(-1, Math.min(1, raw));
}
