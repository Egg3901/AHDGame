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

/**
 * Compatibility distribution for a delivered national grant pool when the law
 * does not yet author a more specific formula. Integer largest remainders keep
 * the regional receipts equal to the delivered department outlay.
 */
export function distributeAnnualRegionalGrantPool(
  annualPool: number,
  regions: ReadonlyArray<{ id: string; population: number }>
): Record<string, number> {
  if (!Number.isFinite(annualPool)) throw new Error("annual grant pool must be finite");
  const pool = Math.max(0, Math.round(annualPool));
  const ordered = [...regions].sort((a, b) => a.id.localeCompare(b.id));
  if (ordered.length === 0) return {};
  if (new Set(ordered.map((region) => region.id)).size !== ordered.length) {
    throw new Error("regional grant recipients must have unique ids");
  }
  for (const region of ordered) {
    if (!Number.isFinite(region.population) || region.population < 0) {
      throw new Error(`invalid regional population: ${region.id}`);
    }
  }
  const totalPopulation = ordered.reduce((sum, region) => sum + region.population, 0);
  const equalWeight = totalPopulation === 0;
  const weightTotal = equalWeight ? ordered.length : totalPopulation;
  const provisional = ordered.map((region) => {
    const weight = equalWeight ? 1 : region.population;
    const exact = (pool * weight) / weightTotal;
    const amount = Math.floor(exact);
    return { region, amount, remainder: exact - amount };
  });
  let residual = pool - provisional.reduce((sum, row) => sum + row.amount, 0);
  provisional.sort((a, b) => b.remainder - a.remainder || a.region.id.localeCompare(b.region.id));
  for (const row of provisional) {
    if (residual === 0) break;
    row.amount += 1;
    residual -= 1;
  }
  return Object.fromEntries(provisional.map((row) => [row.region.id, row.amount]));
}
