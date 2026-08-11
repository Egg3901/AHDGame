/**
 * Split a treasury spend into the part funded from accumulated surplus and the
 * part that becomes new national debt (financed at the next bond issuance).
 * `treasuryBalance` is the signed SSOT (positive = surplus, negative = debt).
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
