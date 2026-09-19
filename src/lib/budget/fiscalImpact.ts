/**
 * Split a treasury spend into the part funded from accumulated surplus and the
 * part that pushes cash negative (a cash hole, financed at the next bond
 * issuance; bond-ledger `debt.principal` itself is never derived here, see
 * bonds/sovereignPrincipal.ts and refs #1975).
 * `treasuryBalance` is signed cash (positive = surplus, negative = hole).
 * Pure — drives the slider/contribution fiscal badge with no DB access.
 */
export function computeFiscalImpact(
  treasuryBalance: number,
  amount: number
): { fromSurplus: number; addedToDebt: number } {
  const spend = Math.max(0, amount);
  const fromSurplus = Math.max(0, Math.min(spend, treasuryBalance));
  return { fromSurplus, addedToDebt: spend - fromSurplus };
}
