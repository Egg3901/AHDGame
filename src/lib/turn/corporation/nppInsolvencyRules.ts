import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

// A shortfall under this share of one turn's earnings is rounding dust, not a
// solvency problem. Sized so a profitable corp sitting a few units below zero
// is not stamped, while a corp that is short by a meaningful fraction of a
// turn's income still is.
export const INSOLVENCY_MATERIALITY_TURN_EARNINGS_SHARE = 0.01;

/**
 * Whether effective cash (anchor currency, after arrears) counts as insolvent
 * for the persistent-insolvency clock. Any positive cash is solvent. A negative
 * balance is ignored only when the corp is earning (latest annualised after-tax
 * income is positive) and the shortfall is immaterial against one turn of that
 * income. A corp with no earnings history or non-positive earnings has no scale
 * to measure against, so any shortfall counts.
 */
export function isMateriallyInsolvent(
  effectiveAnchor: number,
  latestAnnualEarningsAnchor: number | undefined
): boolean {
  if (!(effectiveAnchor < 0)) return false;
  if (latestAnnualEarningsAnchor == null || !(latestAnnualEarningsAnchor > 0)) return true;
  const turnEarnings = latestAnnualEarningsAnchor / TURNS_PER_YEAR;
  return -effectiveAnchor >= turnEarnings * INSOLVENCY_MATERIALITY_TURN_EARNINGS_SHARE;
}
