import { demandSupplyGapPct } from "./administeredPricing";

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
  const validRows: Array<{ gap: number; volume: number; price: number }> = [];
  let maxVolume = 0;
  let maxPrice = 0;
  for (const row of rows) {
    if (row.basis !== "country_scoped_ledger") continue;
    const supply = finiteNonNegative(row.supply);
    const demand = finiteNonNegative(row.demand);
    const price = finiteNonNegative(row.price ?? Number.NaN);
    if (supply == null || demand == null || price == null || price <= 0) continue;
    const volume = Math.max(supply, demand);
    if (!(volume > 0)) continue;
    // Keep the gap bounded at the consumer's 500-point ceiling and defer
    // multiplying volume by price until both have been normalised. A direct
    // value multiplication can overflow for otherwise valid ledger numbers.
    const gap = Math.min(500, demandSupplyGapPct(supply, demand));
    if (!Number.isFinite(gap)) continue;
    validRows.push({ gap, volume, price });
    maxVolume = Math.max(maxVolume, volume);
    maxPrice = Math.max(maxPrice, price);
  }
  if (!(maxVolume > 0) || !(maxPrice > 0)) return null;

  let weightedGap = 0;
  let weight = 0;
  for (const row of validRows) {
    const normalizedWeight = (row.volume / maxVolume) * (row.price / maxPrice);
    if (!(normalizedWeight > 0) || !Number.isFinite(normalizedWeight)) continue;
    weightedGap += row.gap * normalizedWeight;
    weight += normalizedWeight;
  }
  return weight > 0 && Number.isFinite(weightedGap) ? weightedGap / weight : null;
}

/** Overhang is a pressure index, not a currency amount. */
export const OVERHANG_CAP = 100;

/** Physical scarcity adds at most six shortage points to the overhang signal. */
export const MAX_PHYSICAL_SHORTAGE_CONTRIBUTION = 6;

/**
 * Shortage index in [0, 100]. The observed demand-supply gap is expressed as
 * a percent of supply, capped at 500. The six-point physical contribution
 * limits added repression loss to 1.728 points/year at 60% repression.
 * Missing/non-finite observations contribute zero; overhang is unchanged.
 */
export function shortageIndexFrom(overhang: number, demandSupplyGapPct = 0): number {
  const bounded = (value: number, cap: number) =>
    Number.isFinite(value) ? Math.max(0, Math.min(cap, value)) : 0;
  return Math.min(
    100,
    0.7 * bounded(overhang, OVERHANG_CAP) +
      (MAX_PHYSICAL_SHORTAGE_CONTRIBUTION * bounded(demandSupplyGapPct, 500)) / 500
  );
}
