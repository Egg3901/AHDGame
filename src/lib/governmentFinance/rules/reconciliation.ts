import type { ProgramAccountInput, ProgramAccountSettlement, ReconciliationResult } from "./types";

export function currencyAmount(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  if (value < 0) throw new Error(`${field} cannot be negative`);
  return Math.round(value);
}

export function reconcileProgramSettlement(
  input: ProgramAccountInput,
  settlement: ProgramAccountSettlement
): ReconciliationResult {
  const failures: string[] = [];
  const expectedClosing =
    currencyAmount(input.openingBalance, "openingBalance") +
    settlement.authorityAccrued -
    settlement.outlaid;

  if (settlement.closingBalance !== expectedClosing) {
    failures.push(`closing balance ${settlement.closingBalance} does not equal ${expectedClosing}`);
  }
  if (settlement.availableBalance + settlement.closingEncumbered !== settlement.closingBalance) {
    failures.push("available balance plus encumbrance does not equal closing balance");
  }
  if (settlement.closingEncumbered > settlement.closingBalance) {
    failures.push("encumbrance exceeds closing balance");
  }
  if (settlement.outlaid > settlement.obligated) {
    failures.push("outlays exceed obligations");
  }
  if (settlement.obligated > settlement.programDemand) {
    failures.push("obligations exceed program demand");
  }
  if (
    settlement.closingBalance < 0 ||
    settlement.closingEncumbered < 0 ||
    settlement.availableBalance < 0
  ) {
    failures.push("a monetary balance is negative");
  }
  if (settlement.arrears !== 0) {
    failures.push("the discretionary slice cannot create arrears");
  }

  return { ok: failures.length === 0, failures };
}
