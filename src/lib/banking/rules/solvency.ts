/**
 * Run and contagion constants, and the failure test itself. The solvency turn
 * is the shell that reads the banks, applies these, and writes the outcome.
 */

import type { ConfidenceBand } from "@/lib/banking/rules/confidence";
import { RUN_FAILURE_COVER_FRACTION } from "@/lib/banking/rules/balanceSheet";

/**
 * Provisional - fraction of npcDeposits that flee per solvency turn by band.
 * Independent of the banking turn's normal NPC flow cap.
 */
export const FLIGHT_RATE_BY_BAND: Readonly<Record<"amber" | "red", number>> = {
  amber: 0.1,
  red: 0.3,
};

/** Provisional - panicTurns stamped onto same-currency peers on a failure. */
export const CONTAGION_PANIC_TURNS = 4;

/**
 * A deposit taker fails when it is already published red AND its cash has
 * fallen below the run line, which is {@link RUN_FAILURE_COVER_FRACTION} of
 * the reserves it must hold against the cash-backed deposit base.
 */
export function depositTakerFails(input: {
  priorBand: ConfidenceBand | undefined;
  cashReserves: number;
  requiredLiquidity: number;
}): boolean {
  return (
    input.priorBand === "red" &&
    input.cashReserves < RUN_FAILURE_COVER_FRACTION * Math.max(0, input.requiredLiquidity)
  );
}

/** An investment bank fails when red with no equity left behind its book. */
export function propBankFails(input: { band: ConfidenceBand; equityBase: number }): boolean {
  return input.band === "red" && input.equityBase <= 0;
}

/** Deposits that flee this turn under a published band, capped at cash on hand. */
export function depositFlight(input: {
  priorBand: ConfidenceBand | undefined;
  npcDeposits: number;
  cashReserves: number;
}): number {
  if (input.priorBand !== "amber" && input.priorBand !== "red") return 0;
  const rate = FLIGHT_RATE_BY_BAND[input.priorBand];
  return Math.min(Math.max(0, input.npcDeposits) * rate, Math.max(0, input.cashReserves));
}
