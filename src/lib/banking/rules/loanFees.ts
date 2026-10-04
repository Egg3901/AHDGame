import type { CurrencyCode } from "@/lib/constants/currencies";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";

export const LOAN_ORIGINATION_FEE_FRACTION = 0.01;

/** Withhold a quoted fee from funded proceeds while preserving contractual principal. */
export function quoteLoanOrigination(
  principalRaw: number,
  currency: CurrencyCode,
  quotedFee?: number
): { principal: number; originationFee: number; proceeds: number } {
  const principal = Number.isFinite(principalRaw) ? Math.max(0, principalRaw) : 0;
  const maximumFee = Math.min(
    principal,
    roundSavingsAmount(principal * LOAN_ORIGINATION_FEE_FRACTION, currency)
  );
  const originationFee =
    quotedFee === undefined
      ? maximumFee
      : Math.min(maximumFee, Number.isFinite(quotedFee) ? Math.max(0, quotedFee) : 0);
  return { principal, originationFee, proceeds: principal - originationFee };
}
