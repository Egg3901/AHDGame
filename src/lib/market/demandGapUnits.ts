import {
  commodityMixWeight,
  COMMODITY_BASE_PRICES,
  type CommodityType,
} from "@/lib/constants/commodities";

export type CommodityBalance = { supply: number; demand: number };

/**
 * Unmet demand for a sector output mix, in sector output units.
 *
 * A sector unit splits across its outputs by `commodityMixWeight`, so extra
 * capacity only sells until the FIRST output leg saturates — hence the min,
 * not a sum. 0 in a glut. Scope is the caller's: pass the book this plant
 * actually sells into (country clearing book, or a single state's S/D).
 */
export function demandGapUnitsForMix(
  supplyMix: Partial<Record<CommodityType, number>>,
  balances: ReadonlyMap<CommodityType, CommodityBalance>,
  basePrices: Record<CommodityType, number> = COMMODITY_BASE_PRICES
): number {
  let minUnits = Infinity;
  for (const [commodity, rate] of Object.entries(supplyMix) as [CommodityType, number][]) {
    if (!(rate > 0)) continue;
    const w = commodityMixWeight(supplyMix, basePrices, commodity);
    if (!(w > 0)) continue;
    const bal = balances.get(commodity);
    const gap = Math.max(0, (bal?.demand ?? 0) - (bal?.supply ?? 0));
    minUnits = Math.min(minUnits, gap / w);
  }
  return Number.isFinite(minUnits) ? minUnits : 0;
}

/** Per-commodity S/D for one state from stored `stateSupply` / `stateDemand`. */
export function stateCommodityBalances(
  prices: ReadonlyArray<{
    commodity: CommodityType;
    stateSupply?: Record<string, number>;
    stateDemand?: Record<string, number>;
  }>,
  stateId: string
): Map<CommodityType, CommodityBalance> {
  const out = new Map<CommodityType, CommodityBalance>();
  for (const p of prices) {
    out.set(p.commodity, {
      supply: p.stateSupply?.[stateId] ?? 0,
      demand: p.stateDemand?.[stateId] ?? 0,
    });
  }
  return out;
}
