import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/**
 * Fraction of annual CPI passed into the household price index. Household
 * prices are deliberately sticky: CPI is a signal, not a blanket rescaling of
 * every nominal field in the economy.
 */
export const HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH = 0.75;

/** Legacy worlds and fresh budgets both begin at the same neutral price level. */
export const HOUSEHOLD_PRICE_INDEX_BASELINE = 1;

/**
 * Lowest annual CPI the index will honour. A 100% annual price fall is already
 * the limit of meaning (every price reaching zero), so anything below it is a
 * malformed observation, not a deeper deflation.
 */
const MIN_ANNUAL_INFLATION_PERCENT = -100;

/**
 * Per-turn household price factor for one annual CPI observation.
 *
 * Contract: annual CPI is an arithmetic year-over-year rate. Households absorb
 * HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH of it, so a full year held at `x`%
 * must move the index by exactly `1 + passthrough * x / 100`. The per-turn
 * factor is that annual factor's TURNS_PER_YEAR-th root, which makes a year of
 * turns compound back to the stated passthrough instead of compounding a
 * linear 1/48 slice past it. When the observation changes between turns, each
 * turn contributes its own 1/TURNS_PER_YEAR share of its annual factor, so a
 * year of varying CPI lands on the geometric mean of the observed annual
 * factors. Missing or non-finite CPI is treated as zero; CPI below -100% is
 * clamped, which keeps the factor strictly positive.
 */
export function householdPriceTurnFactor(
  annualInflationPercent: number | null | undefined
): number {
  const inflation =
    typeof annualInflationPercent === "number" && Number.isFinite(annualInflationPercent)
      ? Math.max(MIN_ANNUAL_INFLATION_PERCENT, annualInflationPercent)
      : 0;
  const annualFactor = 1 + (HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH * inflation) / 100;
  return Math.pow(annualFactor, 1 / TURNS_PER_YEAR);
}

/**
 * Advance the country-level household price index by one turn.
 *
 * This is a one-way read of the already-settled annual inflation rate. Nothing
 * in inflation calculation reads this index: a price level must never become a
 * CPI driver. There is intentionally no upper cap; long-run price-level change
 * is information rather than an error condition. See householdPriceTurnFactor
 * for the annual passthrough contract.
 */
export function advanceHouseholdPriceIndex(
  previousIndex: number | null | undefined,
  annualInflationPercent: number | null | undefined
): number {
  const prior =
    typeof previousIndex === "number" && Number.isFinite(previousIndex) && previousIndex > 0
      ? previousIndex
      : HOUSEHOLD_PRICE_INDEX_BASELINE;
  const next = prior * householdPriceTurnFactor(annualInflationPercent);

  // The turn factor is always positive, but a long deflationary run could still
  // underflow a tiny prior. Never write a zero, negative or non-finite level.
  return Number.isFinite(next) ? Math.max(Number.EPSILON, next) : prior;
}

/** Convert a nominal local-currency amount into launch-price purchasing power. */
export function householdPriceAdjustedValue(
  nominalValue: number | null | undefined,
  householdPriceIndex: number | null | undefined
): number | null {
  if (typeof nominalValue !== "number" || !Number.isFinite(nominalValue)) return null;
  const index =
    typeof householdPriceIndex === "number" &&
    Number.isFinite(householdPriceIndex) &&
    householdPriceIndex > 0
      ? householdPriceIndex
      : HOUSEHOLD_PRICE_INDEX_BASELINE;
  return nominalValue / index;
}
