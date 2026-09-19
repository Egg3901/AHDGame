/**
 * Effective bank rates from the policy rate and the CEO's offsets. The shell
 * (`banking/rates.ts`) validates offsets against the Regulation Q corridor and
 * persists them.
 */

import type { BankCharter } from "@/lib/db/types/bank";

/** Floor on effective deposit rate (percent). Provisional - flagged for user review. */
export const MIN_DEPOSIT_RATE_PERCENT = 0.05;

/** Floor on effective lending rate (percent). Provisional - flagged for user review. */
export const MIN_LENDING_RATE_PERCENT = 0.1;

/**
 * Effective deposit and lending rates = prime + offsets, floored at the
 * module minimums. A missing or non-finite prime reads as zero.
 */
export function effectiveBankRatesFromPrime(
  charter: Pick<BankCharter, "depositOffset" | "lendingOffset">,
  primeRateRaw: number | undefined | null
): { depositRatePercent: number; lendingRatePercent: number } {
  const primeRate =
    typeof primeRateRaw === "number" && Number.isFinite(primeRateRaw) ? primeRateRaw : 0;
  return {
    depositRatePercent: Math.max(MIN_DEPOSIT_RATE_PERCENT, primeRate + charter.depositOffset),
    lendingRatePercent: Math.max(MIN_LENDING_RATE_PERCENT, primeRate + charter.lendingOffset),
  };
}
