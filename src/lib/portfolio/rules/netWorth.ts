/** Personal net worth subtracts loan and unpaid tax liabilities after valuing all assets. */
export function personalNetWorth(assets: number, loanDebt: number, incomeTaxDebt = 0): number {
  if (![assets, loanDebt, incomeTaxDebt].every(Number.isFinite))
    throw new Error("Invalid personal valuation");
  return Math.max(0, assets - loanDebt - incomeTaxDebt);
}
