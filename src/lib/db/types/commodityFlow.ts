import type { CommodityType } from "../../constants/commodities";

/**
 * Per-turn commodity flow ledger row — Tier 2 ("ledger") of the structural
 * market rework (audit t806, Fix 3 phase D0; see
 * docs/plans/2026-07-03-market-structural-plan.md).
 *
 * One document per commodity per turn, written by the commodity-price phase
 * when `marketSystemMode >= "ledger"`. This is a SHADOW of the current
 * abstract model: it records the flows the engine already implies (units
 * supplied/demanded, what would clear, what goes unmet or unsold) without
 * changing any behaviour. Later ledger phases (inventory, throughput
 * coupling) read and extend it; cross-border flows live in
 * `tradeFlowSnapshots` and are deliberately not duplicated here.
 */
export interface CommodityFlow {
  /**
   * This document's demand fields come from the calibrated aggregate ledger,
   * not from state buyer intents processed by the sourcing network.
   */
  basis: "ledger_aggregate";
  /** Global clearing assumes one frictionless world pool. */
  clearingBasis: "global_pooled_availability";
  commodity: CommodityType;
  turn: number;
  /** Units produced (revenue-derived supply, post capacity clamp). */
  supplyUnits: number;
  /** Units demanded (sector inputs + retail/macro/latent legs). */
  demandUnits: number;
  /** Basis-explicit alias for `demandUnits`; preferred by new measurement consumers. */
  demandUnitsLedger: number;
  /** Units that would transact this turn: min(supply, demand). */
  clearedUnits: number;
  /** Basis-explicit alias for `clearedUnits`; preferred by new measurement consumers. */
  clearedUnitsPooled: number;
  /** Demand that found no producer: max(0, demand − supply). */
  unmetDemandUnits: number;
  /** Basis-explicit alias for `unmetDemandUnits`; preferred by new measurement consumers. */
  unmetDemandUnitsPooled: number;
  /** Output that found no buyer: max(0, supply − demand). Inventory-to-be. */
  surplusUnits: number;
  /** Basis-explicit alias for `surplusUnits`; preferred by new measurement consumers. */
  surplusUnitsPooled: number;
  /** Applied global market price this turn. */
  price: number;
  /**
   * Shadow inventory (storable commodities only): global stock after this
   * turn's net flow and spoilage. null for non-storables. Display-only until
   * the "clearing" tier couples stock-to-flow into prices.
   */
  stockUnits: number | null;
  /** Turns of demand the current stock would cover. null when not applicable. */
  coverTurns: number | null;
  /** Units lost to carry/spoilage this turn (includes any cover-cap excess). */
  spoiledUnits: number;
  /**
   * Explicit write-down record: units of above-cap excess stock destroyed by
   * accelerated spoilage this turn (gameConfig.stockCoverCapEnabled; see
   * STOCK_COVER_CAP_TURNS / EXCESS_STOCK_SPOILAGE_RATE in market/inventory).
   * Already counted inside `spoiledUnits`. Present only when > 0.
   */
  excessSpoiledUnits?: number;
  /** Per-country breakdown: countryId → flows at that country's applied price. */
  byCountry: Record<
    string,
    {
      /** This row nets only the named country's post-convergence ledger balance. */
      basis: "country_scoped_ledger";
      supply: number;
      demand: number;
      cleared: number;
      /** Basis-explicit alias for `cleared`; preferred by new measurement consumers. */
      clearedUnitsScoped: number;
      price: number;
    }
  >;
  createdAt: Date;
}
