import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import type { CommodityFlow } from "@/lib/db/types/commodityFlow";
import { advanceStock, daysOfCover, isStorable } from "@/lib/market/inventory";

/**
 * Flow-ledger retention, in turns (5 game years — matches the
 * commodityPriceHistory prune window).
 */
export const COMMODITY_FLOW_RETENTION_TURNS = 240;

type Balance = { supply: number; demand: number };

/**
 * Build the per-commodity flow-ledger docs for one turn — Tier 2 phase D0 of
 * the structural market rework (audit t806, Fix 3). Pure: shadows the flows
 * the current model already implies without changing behaviour. `cleared` is
 * min(supply, demand) — the volume that would transact if buyers and sellers
 * actually met; `surplus` is the unsold output a future inventory phase will
 * accumulate as stock.
 */
export function buildCommodityFlowDocs(args: {
  global: ReadonlyMap<CommodityType, Balance>;
  byCountry: ReadonlyMap<string, ReadonlyMap<CommodityType, Balance>>;
  globalPriceByCommodity: ReadonlyMap<CommodityType, number>;
  nationalPricesByCommodity: ReadonlyMap<CommodityType, Record<string, number>>;
  /** Prior turn's stock per commodity (from the previous flow row); empty on first run. */
  prevStockByCommodity?: ReadonlyMap<CommodityType, number>;
  /**
   * gameConfig.stockCoverCapEnabled: accelerated spoilage on stock above
   * STOCK_COVER_CAP_TURNS × demand (legacy-stockpile overhang defusal).
   * Default off → behaviour identical to before the cap existed.
   */
  coverCapEnabled?: boolean;
  /**
   * Plants tier: per commodity, the units corporate plants physically produced
   * and the units they actually sold this turn. Lets the stock advance book
   * REAL unsold output into inventory instead of inferring it from the
   * supply/demand aggregate — see advanceStock. Absent ⇒ legacy flow model.
   */
  plantsUnitsByCommodity?: ReadonlyMap<CommodityType, { produced: number; sold: number }>;
  turn: number;
  now: Date;
}): CommodityFlow[] {
  const {
    global,
    byCountry,
    globalPriceByCommodity,
    nationalPricesByCommodity,
    prevStockByCommodity,
    coverCapEnabled,
    plantsUnitsByCommodity,
    turn,
    now,
  } = args;
  const round = (n: number) => Math.round(n * 100) / 100;

  return COMMODITY_TYPES.filter((commodity) => global.has(commodity)).map((commodity) => {
    const bal = global.get(commodity)!;
    const perCountry: CommodityFlow["byCountry"] = {};
    const nationalPrices = nationalPricesByCommodity.get(commodity) ?? {};
    for (const [countryId, countryBals] of byCountry) {
      const cb = countryBals.get(commodity);
      if (!cb || (cb.supply <= 0 && cb.demand <= 0)) continue;
      perCountry[countryId] = {
        basis: "country_scoped_ledger",
        supply: round(cb.supply),
        demand: round(cb.demand),
        cleared: round(Math.min(cb.supply, cb.demand)),
        clearedUnitsScoped: round(Math.min(cb.supply, cb.demand)),
        price: nationalPrices[countryId] ?? 0,
      };
    }
    // Plants: state the flow in physical goods. The plants figures cover only
    // corporate plants, so the rest of the ledger's supply (stabilizer, unowned
    // drift, extraction, macro sources) is folded in as production that clears
    // to whatever demand the plants did not already take.
    const plantsUnits = plantsUnitsByCommodity?.get(commodity);
    let producedUnits: number | null = null;
    let soldUnits: number | null = null;
    if (plantsUnits) {
      producedUnits = bal.supply;
      const otherSupply = Math.max(0, bal.supply - plantsUnits.produced);
      const residualDemand = Math.max(0, bal.demand - plantsUnits.sold);
      soldUnits = plantsUnits.sold + Math.min(otherSupply, residualDemand);
    }
    const { stock, spoiledUnits, excessSpoiledUnits } = advanceStock({
      commodity,
      prevStock: prevStockByCommodity?.get(commodity) ?? 0,
      supplyUnits: bal.supply,
      demandUnits: bal.demand,
      coverCapEnabled,
      producedUnits,
      soldUnits,
    });
    return {
      basis: "ledger_aggregate",
      clearingBasis: "global_pooled_availability",
      commodity,
      turn,
      stockUnits: isStorable(commodity) ? stock : null,
      coverTurns: daysOfCover(commodity, stock, bal.demand),
      spoiledUnits,
      // Explicit write-down record for the cover-cap mechanism. Units-only:
      // shadow stock never entered financialTxLog (no currency moved when it
      // accumulated), so the shadow-ledger conservation checker needs no
      // offsetting entry — the write-down lives entirely in this row. If a
      // later tier monetises stock, book a `stock_writedown` financialTxLog
      // entry valued at `excessSpoiledUnits × price` when destroying it.
      ...(excessSpoiledUnits > 0 ? { excessSpoiledUnits } : {}),
      supplyUnits: round(bal.supply),
      demandUnits: round(bal.demand),
      demandUnitsLedger: round(bal.demand),
      clearedUnits: round(Math.min(bal.supply, bal.demand)),
      clearedUnitsPooled: round(Math.min(bal.supply, bal.demand)),
      unmetDemandUnits: round(Math.max(0, bal.demand - bal.supply)),
      unmetDemandUnitsPooled: round(Math.max(0, bal.demand - bal.supply)),
      surplusUnits: round(Math.max(0, bal.supply - bal.demand)),
      surplusUnitsPooled: round(Math.max(0, bal.supply - bal.demand)),
      price: globalPriceByCommodity.get(commodity) ?? 0,
      byCountry: perCountry,
      createdAt: now,
    };
  });
}
