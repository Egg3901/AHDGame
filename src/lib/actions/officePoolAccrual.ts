/**
 * Office action pools (ministerial, vice-president, Justice) regain one action
 * every N turns, banked up to their cap. Accrual is keyed off the turn number
 * so every pool of a kind ticks on the same turns, and each pool stamps the
 * turn it last accrued so a re-run of the same turn phase is a no-op.
 */
export function isOfficePoolAccrualTurn(currentTurn: number, intervalTurns: number): boolean {
  if (!Number.isInteger(currentTurn) || currentTurn <= 0) return false;
  if (!Number.isInteger(intervalTurns) || intervalTurns <= 0) return false;
  return currentTurn % intervalTurns === 0;
}
