/**
 * Effective bank rates from the policy rate and the CEO's offsets. The shell
 * (`banking/rates.ts`) validates offsets against the Regulation Q corridor and
 * persists them.
 */

import type { BankCharter } from "@/lib/db/types/bank";
import { savingsApyPercent } from "@/lib/currency/savingsInterest";

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

/**
 * Rate the bank pays this turn on player savings balances.
 *
 * An authoritative currency pays the full posted rate: the backing cash is in
 * the vault and the liability is real. Any other currency pays only the
 * premium over the CB base APY, because the pointer balance never arrived as
 * cash; the base accrues to the saver in savingsInterestTurn instead.
 * Floored at zero so a posted rate below base pays nothing rather than
 * charging the saver.
 */
export function playerDepositRatePercent(
  depositRatePercent: number,
  playerDepositsAreLiabilities: boolean,
  primeRate: number,
  inflationRate: number
): number {
  if (playerDepositsAreLiabilities) return depositRatePercent;
  const base = savingsApyPercent(
    typeof primeRate === "number" && Number.isFinite(primeRate) ? primeRate : 0,
    typeof inflationRate === "number" && Number.isFinite(inflationRate) ? inflationRate : 0
  );
  return Math.max(0, depositRatePercent - base);
}
