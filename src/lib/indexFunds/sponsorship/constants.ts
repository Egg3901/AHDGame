/**
 * A5 — sponsored funds.
 *
 * Every fund in the game is seeded by the system: a broad fund per country, a
 * sector fund per industry, one global top-50. Players can buy units and that is
 * the whole of their relationship with the fund business.
 *
 * A sponsored fund is a fund a player's finance corporation charters, runs, and
 * earns from. The sponsor puts up seed capital that stays at risk until the fund
 * winds up, and takes an annual expense ratio off assets under management. That
 * fee is the entire business model: the sponsor does NOT get an investor's
 * upside on the fund's holdings, so the incentive is to attract and keep unit
 * holders rather than to trade against them.
 *
 * The fee is a real drag on NAV, which is why the cap is low and the number is
 * on the card. An index fund whose sponsor can quietly skim is not an index
 * fund, it is a tax.
 */

import type { CorporationType } from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/**
 * Only finance corporations may sponsor a fund. Same gate as bank chartering:
 * running other people's money is what the sector is for.
 */
export const FUND_SPONSOR_SECTOR: CorporationType = "financial";

/** Non-refundable incorporation fee, paid to the sponsor's country treasury (₳). */
export const FUND_CHARTER_FEE_ANCHOR = 2_500_000;

/**
 * Seed capital the sponsor must put into the fund at charter (₳). It backs the
 * fund's first units, stays at risk for the fund's whole life, and comes back
 * to the sponsor at wind-up only AFTER every unit holder has been paid.
 */
export const FUND_MIN_SEED_CAPITAL_ANCHOR = 10_000_000;

/**
 * Ceiling on the annual expense ratio, as a fraction of AUM. 2% is already
 * punitive against a fund whose whole pitch is tracking a market; anything
 * higher and the sponsor is simply taking the holders' return.
 */
export const MAX_EXPENSE_RATIO_ANNUAL = 0.02;

/** Floor, so a fund cannot be chartered as a loss-leader to corner an index. */
export const MIN_EXPENSE_RATIO_ANNUAL = 0.001;

/**
 * A fund whose backing has collapsed must not keep paying its sponsor. Below
 * this backing ratio the fee is skipped entirely: the sponsor's income stops
 * exactly when the holders' position is impaired, which is the alignment the
 * whole arrangement depends on.
 */
export const FEE_SUSPENDED_BELOW_BACKING_RATIO = 0.9;

/** Turns a wind-up may run before the remaining holdings are sold at any price. */
export const WIND_DOWN_GRACE_TURNS = 24;

/**
 * Per-turn expense fee in ₳. Annual ratio spread evenly across the game year.
 * Pure so the card and the engine cannot disagree about what a ratio costs.
 */
export function expenseFeeForTurn(aumAnchor: number, expenseRatioAnnual: number): number {
  if (!Number.isFinite(aumAnchor) || aumAnchor <= 0) return 0;
  if (!Number.isFinite(expenseRatioAnnual) || expenseRatioAnnual <= 0) return 0;
  const ratio = Math.min(MAX_EXPENSE_RATIO_ANNUAL, expenseRatioAnnual);
  return (aumAnchor * ratio) / TURNS_PER_YEAR;
}

/** Human-readable basis points, for copy. */
export function expenseRatioBasisPoints(expenseRatioAnnual: number): number {
  return Math.round(expenseRatioAnnual * 10_000);
}
