/**
 * Two-circuit money (P3).
 *
 * The Soviet monetary system ran two non-fungible circuits: enterprise NON-CASH
 * (beznalichnye) money for inter-firm plan settlement, and household CASH. The
 * only sanctioned bridge from non-cash to cash was the WAGE FUND — planners set
 * how much enterprise money could be paid out as wages. That throttle is the
 * primary brake on monetary overhang: if wages are held near real output growth,
 * households never accumulate unspendable money.
 *
 * We model this at the MACRO level (a wage-fund cap on nominal wage growth for
 * planned economies) rather than splitting every player wallet into two buckets
 * — a per-wallet split would ripple across every money writer in the engine and
 * is out of scope for a flag-gated regime. The cap composes with the overhang
 * kernel: a tighter wage fund → less forced saving.
 *
 * Pure and NaN-guarded.
 */

const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/** Slack the plan allows wages above real output growth (percentage points). */
export const WAGE_FUND_SLACK_PP = 2;

/**
 * Wage growth actually permitted under the two-circuit wage fund. For a fully
 * planned economy (`plannedShare` → 1) nominal wage growth is pulled down toward
 * `realGoodsGrowth + WAGE_FUND_SLACK_PP`; for a dual-track economy the pull is
 * proportional to the planned share; a market economy is unconstrained.
 *
 * Only ever LOWERS wage growth (the fund is a ceiling, never a floor).
 */
export function wageFundConstrainedGrowth(
  wageGrowth: number,
  realGoodsGrowth: number,
  plannedShare: number
): number {
  const wage = finite(wageGrowth, 0);
  const goods = finite(realGoodsGrowth, 0);
  const share = Math.min(1, Math.max(0, finite(plannedShare, 0)));
  const cap = goods + WAGE_FUND_SLACK_PP;
  if (wage <= cap) return wage; // already within the fund
  // Pull the excess down by the planned share (dual-track only partially binds).
  return wage - share * (wage - cap);
}
