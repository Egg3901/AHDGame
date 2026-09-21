import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { currencyAmount } from "./reconciliation";

/**
 * Deterministically distribute integer annual authority across turn slots.
 * The cumulative-floor method conserves the exact annual amount over every
 * complete year instead of multiplying a rounded average by 48.
 */
export function includedAuthorityPerTurn(annualAuthority: number, turn: number): number {
  const annual = currencyAmount(annualAuthority, "annualAuthority");
  if (!Number.isInteger(turn) || turn < 1) throw new Error("turn must be a positive integer");
  const slot = (turn - 1) % TURNS_PER_YEAR;
  return (
    Math.floor((annual * (slot + 1)) / TURNS_PER_YEAR) -
    Math.floor((annual * slot) / TURNS_PER_YEAR)
  );
}
