import {
  commodityMixWeight,
  COMMODITY_BASE_PRICES,
  type CommodityType,
} from "@/lib/constants/commodities";

/**
 * Expansion appetite for one more unit of a sector's output, in sector output
 * units: the rate-weighted MEAN unmet demand across the sector's output legs.
 *
 * Each leg converts to sector units by `commodityMixWeight` (one sector unit
 * splits across the mix), then legs average by supply rate — the same
 * rate-weighted-mean philosophy as the bot-side `sectorShortageScore`, so the
 * advisor and the NPP brain rank mixed plants consistently.
 *
 * Was the MIN over legs (a plant could only expand into its smallest
 * shortage). The min is the honest "units sellable with nothing left over"
 * number, but as an EXPANSION signal it vetoed every mixed plant with one
 * balanced line: a chemical plant making `{chemicals: 0.5, plastics: 0.15}`
 * quoted zero room — and sorted last — while chemicals ran a deep shortage,
 * because plastics was balanced (demand audit step 4). The mean lets
 * expansion answer the deep leg while accepting slower sell-through on the
 * balanced one; players still decide freely, and uniformly glutted markets
 * still read ~0. Single-output sectors are byte-identical under either
 * aggregation.
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
  let weightedUnits = 0;
  let totalRate = 0;
  for (const [commodity, rate] of Object.entries(supplyMix) as [CommodityType, number][]) {
    if (!(rate > 0)) continue;
    const weight = commodityMixWeight(supplyMix, COMMODITY_BASE_PRICES, commodity);
    if (!(weight > 0)) continue;
    weightedUnits += rate * (Math.max(0, gapForCommodity(commodity)) / weight);
    totalRate += rate;
  }
  return totalRate > 0 ? weightedUnits / totalRate : 0;
}
