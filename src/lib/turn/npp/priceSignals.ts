import type { CommodityType } from "@/lib/constants/commodities";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import { latentAwareNationalRatio, latentAwareStateRatio } from "@/lib/market/latentShortageSignal";
import type { CommodityPriceRatioFn } from "./marketSignals";

export function buildNppPriceSignals(priceByCommodity: ReadonlyMap<string, CommodityPrice>): {
  priceRatioOf: CommodityPriceRatioFn;
  statePriceRatioOf: (commodity: CommodityType, stateId: string) => number | null;
} {
  const priceRatioOf: CommodityPriceRatioFn = (commodity, countryId) => {
    const doc = priceByCommodity.get(commodity);
    if (!doc || !doc.basePrice) return null;
    // Prefer the reachable-market price: the NPP brain should chase the market
    // its sectors actually clear in, not the planet-wide aggregate.
    const price =
      doc.reachablePrices?.[countryId] ?? doc.nationalPrices?.[countryId] ?? doc.globalPrice;
    if (!price || !Number.isFinite(price)) return null;
    const stored = price / doc.basePrice;
    return latentAwareNationalRatio(doc, countryId, stored) ?? stored;
  };

  const statePriceRatioOf = (commodity: CommodityType, stateId: string): number | null => {
    const doc = priceByCommodity.get(commodity);
    if (!doc || !doc.basePrice) return null;
    const price = doc.statePrices?.[stateId];
    if (price == null || !Number.isFinite(price)) return null;
    const stored = price / doc.basePrice;
    return latentAwareStateRatio(doc, stateId, stored) ?? stored;
  };

  return { priceRatioOf, statePriceRatioOf };
}
