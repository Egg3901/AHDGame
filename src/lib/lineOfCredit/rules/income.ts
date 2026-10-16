/** Tax payments reduce recurring-income underwriting; net losses cannot create credit. */
export function recurringIncomePerTurn(netIncome: number, observationTurns: number): number {
  return observationTurns > 0 ? Math.max(0, netIncome) / observationTurns : 0;
}
