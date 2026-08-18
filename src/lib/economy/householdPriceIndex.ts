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
 * Advance the country-level household price index by one turn.
 *
 * This is a one-way read of the already-settled annual inflation rate. Nothing
 * in inflation calculation reads this index: a price level must never become a
 * CPI driver. There is intentionally no upper cap; long-run price-level change
 * is information rather than an error condition.
 */
export function advanceHouseholdPriceIndex(
  previousIndex: number | null | undefined,
  annualInflationPercent: number | null | undefined
): number {
  const prior =
    typeof previousIndex === "number" && Number.isFinite(previousIndex) && previousIndex > 0
      ? previousIndex
      : HOUSEHOLD_PRICE_INDEX_BASELINE;
  const inflation =
    typeof annualInflationPercent === "number" && Number.isFinite(annualInflationPercent)
      ? annualInflationPercent
      : 0;
  const perTurnChange = (HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH * inflation) / 100 / TURNS_PER_YEAR;

  // The inflation engine's floor is far above -100%, but retain this guard so a
  // malformed caller cannot write a zero or negative price level.
  return Math.max(Number.EPSILON, prior * (1 + perTurnChange));
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
