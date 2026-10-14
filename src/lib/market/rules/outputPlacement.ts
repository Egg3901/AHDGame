import type { CommodityType } from "@/lib/constants/commodities";

/** Limit each sale leg to its own measured placement, without coupling byproducts. */
export function outputPlacementRatios(
  supplyRates: Partial<Record<CommodityType, number>>,
  measured: ReadonlyMap<CommodityType, number> | undefined
): Partial<Record<CommodityType, number>> | undefined {
  if (!measured) return undefined;
  const ratios: Partial<Record<CommodityType, number>> = {};
  for (const commodity of Object.keys(supplyRates) as CommodityType[]) {
    if (!((supplyRates[commodity] ?? 0) > 0)) continue;
    const ratio = measured.get(commodity);
    if (ratio !== undefined && Number.isFinite(ratio))
      ratios[commodity] = Math.max(0, Math.min(1, ratio));
  }
  return ratios;
}
