/** Group buyers pay the applicable benchmark for actual inputs, within their allocation. Public inputs retain their usual price. */
export interface GroupInputAllocation {
  units: number;
  marketFactor: number;
}
export function groupInputCost(
  units: number,
  basePrice: number,
  publicUnitPrice: number,
  allocation: GroupInputAllocation | undefined
): { cost: number; groupUnits: number } {
  const valid =
    allocation &&
    Number.isFinite(allocation.units) &&
    allocation.units > 0 &&
    Number.isFinite(allocation.marketFactor) &&
    allocation.marketFactor > 0;
  const groupUnits = valid ? Math.min(units, allocation.units) : 0;
  const groupUnitPrice = valid ? basePrice * allocation.marketFactor : publicUnitPrice;
  return { cost: (units - groupUnits) * publicUnitPrice + groupUnits * groupUnitPrice, groupUnits };
}
