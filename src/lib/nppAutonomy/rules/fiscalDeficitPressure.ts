/** Deficits bias autonomous legislation toward restraint before debt exhausts fiscal headroom. */
export function fiscalDeficitPressure(balanceGdpShare: number | undefined): number {
  if (balanceGdpShare == null || !Number.isFinite(balanceGdpShare)) return 0;
  // Allow ordinary cyclical deficits. Beyond 3%, pressure rises continuously;
  // the existing bill cadence and political process determine actual adjustment.
  return Math.min(2, Math.max(0, -balanceGdpShare - 0.03) * 20);
}

/** Use coherent annual revenue/spending fields; unknown accounting is not a zero deficit. */
export function fiscalBalanceGdpShare(input: {
  gdp?: number;
  revenueTotal?: number;
  spendingTotal?: number;
}): number | undefined {
  const { gdp, revenueTotal, spendingTotal } = input;
  if (
    typeof gdp !== "number" ||
    !Number.isFinite(gdp) ||
    gdp <= 0 ||
    typeof revenueTotal !== "number" ||
    !Number.isFinite(revenueTotal) ||
    revenueTotal < 0 ||
    typeof spendingTotal !== "number" ||
    !Number.isFinite(spendingTotal) ||
    spendingTotal < 0
  )
    return undefined;
  return (revenueTotal - spendingTotal) / gdp;
}
