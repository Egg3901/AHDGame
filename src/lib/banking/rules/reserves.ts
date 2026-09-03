/**
 * Reserve requirement arithmetic. The shell (`banking/reserves.ts`) reads and
 * writes the currency's requirement on the central bank document.
 */

import type { BankCharter } from "@/lib/db/types/bank";
import { cashBackedDeposits } from "@/lib/banking/rules/balanceSheet";

export {
  RESERVE_REQUIREMENT_HISTORICAL_DEFAULT,
  RESERVE_REQUIREMENT_MODERN_DEFAULT,
  RESERVE_REQUIREMENT_MIN,
  RESERVE_REQUIREMENT_MAX,
} from "@/lib/banking/rules/reserveBounds";

/**
 * Deposits that may still be lent after reserves and existing loans:
 * max(0, cashBackedDeposits * (1 - reserveRatio) - totalLoans).
 *
 * Cash-backed deposits only. Player pointer balances never arrived as cash,
 * so lending against them was lending money the bank does not hold.
 */
export function getLendableHeadroom(
  charter: Pick<BankCharter, "npcDeposits" | "totalLoans">,
  reserveRatio: number
): number {
  const deposits = cashBackedDeposits(charter);
  const loans = charter.totalLoans ?? 0;
  const ratio = Number.isFinite(reserveRatio) ? reserveRatio : 0;
  return Math.max(0, deposits * (1 - ratio) - loans);
}

/**
 * Era default when the central bank has not set a requirement: historical
 * worlds (unit scale above 1) hold more.
 */
export function defaultReserveRequirement(eraUnitScale: number): number {
  return eraUnitScale > 1 ? 0.2 : 0.1;
}
