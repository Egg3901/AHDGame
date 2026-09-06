/** Pure command-economy rules that do not require a database or runtime state. */

export interface CountryPhysicalFlowRow {
  supply: number;
  demand: number;
  price?: number;
  basis?: string;
}

const finiteNonNegative = (value: number): number | null =>
  Number.isFinite(value) && value >= 0 ? value : null;

/**
 * Aggregate a country's observed ledger gap without pooling unlike
 * commodities. Rows must be basis-explicit and contain finite, non-negative
 * supply/demand plus a finite, positive price. The result is an observed
 * ledger diagnostic, not a reconstruction of uncapped buyer intent.
 */
export function countryPhysicalDemandSupplyGapPct(
  rows: readonly CountryPhysicalFlowRow[]
): number | null {
  let weightedGap = 0;
  let weight = 0;
  for (const row of rows) {
    if (row.basis !== "country_scoped_ledger") continue;
    const supply = finiteNonNegative(row.supply);
    const demand = finiteNonNegative(row.demand);
    const price = finiteNonNegative(row.price ?? Number.NaN);
    if (supply == null || demand == null || price == null || price <= 0) continue;
    const flowValue = Math.max(supply, demand) * price;
    if (flowValue <= 0) continue;
    const gap = demand > supply ? ((demand - supply) / (supply + 1)) * 100 : 0;
    weightedGap += gap * flowValue;
    weight += flowValue;
  }
  return weight > 0 ? weightedGap / weight : null;
}
