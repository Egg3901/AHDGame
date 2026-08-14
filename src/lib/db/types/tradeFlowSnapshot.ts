import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import type { ReachableBooksDoc } from "@/lib/trade/reachableBook";

/**
 * Per-turn snapshot of cleared inter-country trade. One document per turn,
 * self-populating each turn (no migration). All monetary values are in ₳
 * (anchor) — display layers convert to the viewer's currency. Written by the
 * commodity-price turn phase in Phase 2; this interface locks the contract.
 */
export interface TradeFlowSnapshot {
  _id: ObjectId;
  turn: number;
  updatedAt: Date;
  /** Per-commodity directed flow matrices and rollups (₳). */
  commodities: Partial<Record<CommodityType, CommodityTradeFlows>>;
  /** Country-level rollup across all commodities (₳). */
  national: Partial<Record<CountryId, NationalTradeRollup>>;
  /** World totals (₳). */
  world: { grossVolume: number; clearedVolume: number; unclearedSurplus: number };
  /**
   * Per-country reachable market books in commodity UNITS (ticket #1077), for
   * read surfaces that must quote the market a seller can actually reach rather
   * than the global aggregate. Optional: documents written before 1.1.2 do not
   * carry it, and callers fall back to the global figures.
   */
  books?: ReachableBooksDoc;
}

export interface CommodityTradeFlows {
  /** flow[exporter][importer] in ₳ value; exporter ≠ importer. */
  flow: Record<string, Record<string, number>>;
  /** Per country: cleared exports/imports/net plus residual (₳). */
  perCountry: Record<string, { exports: number; imports: number; net: number; uncleared: number }>;
  /** Total ₳ value that changed hands for this commodity. */
  worldVolume: number;
}

export interface NationalTradeRollup {
  exports: number;
  imports: number;
  net: number;
  topPartnerSurplus?: { countryId: CountryId; net: number };
  topPartnerDeficit?: { countryId: CountryId; net: number };
}
