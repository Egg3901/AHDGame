import type { CommodityType } from "../../constants/commodities";

/**
 * Historical snapshot of a commodity's global price per turn.
 * One document per commodity per turn. Used for price-over-time charts.
 */
export interface CommodityPriceHistory {
  commodity: CommodityType;
  turn: number;
  globalPrice: number;
  globalSupply: number;
  globalDemand: number;
  /** See CommodityPrice.demandTruncatedUnits (#1460). */
  demandTruncatedUnits?: number;
  /** See CommodityPrice.latentShortageMultiple (#1460). */
  latentShortageMultiple?: number;
  /** Per-state prices snapshot. Only states with sector activity are included. */
  statePrices?: Record<string, number>;
  /** Per-country aggregate prices snapshot: countryId -> price */
  nationalPrices?: Record<string, number>;
  createdAt: Date;
}
