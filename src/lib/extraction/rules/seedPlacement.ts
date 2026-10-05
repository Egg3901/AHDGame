/** Seed miners choose a region and recipe supported by actual deposits. */
import { COMMODITY_BASE_PRICES, type ExtractableResource } from "@/lib/constants/commodities";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";

export function chooseSeedExtractionSite(
  regions: readonly {
    stateId: string;
    resources: Partial<Record<ExtractableResource, number>>;
  }[]
): { stateId: string; strategyId: string; supportedDailyRevenue: number } | null {
  let best: { stateId: string; strategyId: string; supportedDailyRevenue: number } | null = null;
  for (const region of regions) {
    for (const strategy of SECTOR_STRATEGIES.extraction) {
      const ceilings = Object.entries(strategy.supply)
        .filter(([, rate]) => rate > 0)
        .map(([key, rate]) => {
          const resource = key as ExtractableResource;
          return ((region.resources[resource] ?? 0) * COMMODITY_BASE_PRICES[resource]) / rate;
        });
      const supportedDailyRevenue = Math.min(...ceilings);
      if (
        Number.isFinite(supportedDailyRevenue) &&
        supportedDailyRevenue > (best?.supportedDailyRevenue ?? 0)
      ) {
        best = { stateId: region.stateId, strategyId: strategy.id, supportedDailyRevenue };
      }
    }
  }
  return best;
}
