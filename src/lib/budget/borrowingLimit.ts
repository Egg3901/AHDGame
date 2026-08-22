import type { CountryId } from "@/lib/constants/countries";

/**
 * East Germany's authored M10B borrowing limit was only 20% of seed GDP and
 * stayed frozen in 1953 marks while the economy grew. Credit pricing already
 * supplies the escalating cost of deficit spending, so keep a modest real
 * borrowing lane instead of letting nominal growth silently close it.
 */
export const DD_MIN_BORROWING_LIMIT_TO_GDP = 0.4;

export function effectiveBorrowingLimit(input: {
  countryId: CountryId | string;
  gdp: number;
  storedCeiling: number;
}): number {
  const stored = Number.isFinite(input.storedCeiling) ? Math.max(0, input.storedCeiling) : 0;
  if (input.countryId !== "DD" || !Number.isFinite(input.gdp) || input.gdp <= 0) return stored;
  return Math.max(stored, input.gdp * DD_MIN_BORROWING_LIMIT_TO_GDP);
}
