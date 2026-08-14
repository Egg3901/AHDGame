import {
  commodityMixWeight,
  COMMODITY_BASE_PRICES,
  type CommodityType,
} from "@/lib/constants/commodities";

/**
 * Buyers' room for one more unit of a sector's output, in sector output units.
 *
 * A sector unit splits across its output mix by `commodityMixWeight`, so the
 * market absorbs extra units only until the FIRST output leg runs out of unmet
 * demand. Hence the min over legs, not a sum: a chemical plant making
 * `{chemicals: 0.5, plastics: 0.15}` cannot sell its chemicals into a plastics
 * shortage.
 *
 * `gapForCommodity` supplies the unmet demand for one commodity, in commodity
 * units. Callers pass the REACHABLE book gap (`reachableDemandGap`, ticket
 * #1077) and fall back to the global aggregate only on worlds that have not yet
 * persisted a book.
 *
 * Lived in two places before (`expand-suggestions/route.ts` and
 * `queries/sectorDetail.ts`) with identical bodies, which is exactly how a
 * preview and a confirm drift apart.
 */
export function sectorDemandGapUnits(
  supplyMix: Partial<Record<CommodityType, number>>,
  gapForCommodity: (commodity: CommodityType) => number
): number {
  let minUnits = Number.POSITIVE_INFINITY;
  for (const [commodity, rate] of Object.entries(supplyMix) as [CommodityType, number][]) {
    if (!(rate > 0)) continue;
    const weight = commodityMixWeight(supplyMix, COMMODITY_BASE_PRICES, commodity);
    if (!(weight > 0)) continue;
    minUnits = Math.min(minUnits, Math.max(0, gapForCommodity(commodity)) / weight);
  }
  return Number.isFinite(minUnits) ? minUnits : 0;
}
