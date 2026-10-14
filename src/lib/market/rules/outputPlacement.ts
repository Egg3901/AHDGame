import type { CommodityType } from "@/lib/constants/commodities";

/** Limit each sale leg to its own measured placement, without coupling byproducts. */
/**
 * Per-commodity placement ratio for REVENUE: the placed share plus the share
 * the freight network could not haul (delivery-limited), capped at 1. The
 * revenue-follows-placement phase removes pay only for output no buyer wanted;
 * output stuck behind a freight shortage is a delivery failure the producer
 * cannot fix alone, and freight's own price already signals the builders.
 */
export function revenuePlacementRatios(
  placement: ReadonlyMap<CommodityType, number> | undefined,
  deliveryLimited: ReadonlyMap<CommodityType, number> | undefined
): Map<CommodityType, number> | undefined {
  if (!placement) return undefined;
  const merged = new Map<CommodityType, number>();
  for (const [commodity, placed] of placement) {
    const limited = deliveryLimited?.get(commodity) ?? 0;
    merged.set(
      commodity,
      Math.max(0, Math.min(1, placed + (Number.isFinite(limited) ? Math.max(0, limited) : 0)))
    );
  }
  return merged;
}

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
