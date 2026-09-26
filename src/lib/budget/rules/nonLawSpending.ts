/** Grow the separately calibrated non-law fiscal envelope with nominal GDP. */
export function nonLawSpendingAmount(gdp: number, share: number | undefined): number {
  if (
    !Number.isFinite(gdp) ||
    gdp <= 0 ||
    typeof share !== "number" ||
    !Number.isFinite(share) ||
    share <= 0
  )
    return 0;
  return Math.round(gdp * share);
}
