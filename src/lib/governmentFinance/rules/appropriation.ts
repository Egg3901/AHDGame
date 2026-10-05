import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { currencyAmount } from "./reconciliation";

/**
 * Deterministically distribute integer annual authority across turn slots.
 * The cumulative-floor method conserves the exact annual amount over every
 * complete year instead of multiplying a rounded average by 48.
 */
export function includedAuthorityPerTurn(annualAuthority: number, turn: number): number {
  const annual = currencyAmount(annualAuthority, "annualAuthority");
  if (!Number.isSafeInteger(annual)) {
    throw new Error("annualAuthority must be a safe integer");
  }
  if (!Number.isInteger(turn) || turn < 1) throw new Error("turn must be a positive integer");
  const slot = (turn - 1) % TURNS_PER_YEAR;
  // The annual value may itself be safe while multiplying by 48 is not.
  // Integer arithmetic keeps yen-scale source claims exact across the year.
  const amount = BigInt(annual);
  const periods = BigInt(TURNS_PER_YEAR);
  return Number((amount * BigInt(slot + 1)) / periods - (amount * BigInt(slot)) / periods);
}
