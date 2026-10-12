/** Sponsored funds transfer fees from fund cash to the managing corporation. */

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
 * Seed cash required at charter (anchor units). New contracts buy ordinary
 * sponsor units that share the portfolio's gains and losses. Legacy funds
 * retain their original residual seed contract.
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
