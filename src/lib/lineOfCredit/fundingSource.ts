import type { LoanFundingSource } from "@/lib/db/types/character";

export const DEFAULT_LOAN_FUNDING_SOURCE: LoanFundingSource = "both";

/**
 * Resolve the principal split between bank deposits and bank reserves for a
 * given face-currency amount, based on the loan's funding source.
 *
 *   "deposits"  → 100% from deposits
 *   "reserves"  → 100% from reserves
 *   "both"      → 50% deposits, 50% reserves (rounded so split sums exactly)
 *
 * Both halves are returned as face-currency amounts in the same currency as
 * the input. Caller is responsible for the central-bank pool updates.
 */
export function splitPrincipalByFundingSource(
  amount: number,
  source: LoanFundingSource
): { fromDeposits: number; fromReserves: number } {
  if (amount <= 0) return { fromDeposits: 0, fromReserves: 0 };
  if (source === "deposits") return { fromDeposits: amount, fromReserves: 0 };
  if (source === "reserves") return { fromDeposits: 0, fromReserves: amount };
  // "both" — split 50/50; assign rounding crumb to deposits to keep the sum exact.
  const halfReserves = Math.round((amount / 2) * 1e8) / 1e8;
  const halfDeposits = amount - halfReserves;
  return { fromDeposits: halfDeposits, fromReserves: halfReserves };
}

export const LOAN_FUNDING_SOURCES: readonly LoanFundingSource[] = [
  "deposits",
  "reserves",
  "both",
] as const;

export function isValidFundingSource(value: unknown): value is LoanFundingSource {
  return value === "deposits" || value === "reserves" || value === "both";
}
