import type { DepartmentAccount } from "@/lib/db/types/budget";
import { clampRatio } from "./rules/implementation";

/**
 * Annualized national grant delivery available to regional treasuries. This is
 * a read of the department sub-ledger, not a second sovereign expenditure.
 */
export function resolveAnnualRegionalGrantPool(input: {
  accounts: Readonly<Record<string, DepartmentAccount>>;
  currentTurn: number;
}): { hasProgram: boolean; annualPool: number } {
  let total = 0;
  let hasProgram = false;
  for (const account of Object.values(input.accounts)) {
    for (const program of Object.values(account.programs)) {
      if (program.jurisdictionMode !== "grant_supported_regional") continue;
      hasProgram = true;
      if (program.lastSettledTurn !== input.currentTurn) continue;
      if (program.status !== "authorized" && program.status !== "operating") continue;
      total += Math.max(0, program.annualDemand) * clampRatio(program.implementationFactor);
    }
  }
  return { hasProgram, annualPool: Math.round(total) };
}
