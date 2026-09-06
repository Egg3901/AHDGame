import type { CommodityType } from "../../constants/commodities";

/**
 * Stored commodity market price, updated each turn.
 * One document per commodity per turn snapshot.
 */
export interface CommodityPrice {
  /** Commodity type identifier */
  commodity: CommodityType;
  /** Base price (constant, from COMMODITY_BASE_PRICES) */
  basePrice: number;
  /** Current global market price (input to the 50/25/25 blend used for state prices). */
  globalPrice: number;
  /** Global supply in units/day */
  globalSupply: number;
  /** Global demand in units/day, AFTER the 1.5x demand caps. */
  globalDemand: number;
  /**
   * Demand units the PLANTS_LEDGER_DEMAND_SUPPLY_CAP and
   * PLANTS_HOUSEHOLD_SUPPLY_CAP passes removed this turn (#1460). Absent when
   * nothing was truncated. Recorded only; not an input to any price.
   */
  demandTruncatedUnits?: number;
  /**
   * (globalDemand + demandTruncatedUnits) / globalSupply: the shortage the
   * world would report without the caps. Absent when nothing was truncated.
   */
  latentShortageMultiple?: number;
  /** Per-state prices: stateId -> price */
  statePrices: Record<string, number>;
  /** Per-state supply: stateId -> units/day */
  stateSupply: Record<string, number>;
  /** Per-state demand: stateId -> units/day */
  stateDemand: Record<string, number>;
  /**
   * Physical goods delivered to buyers after the prior turn's freight
   * settlement.  Omitted while settlement is in shadow mode.
   */
  stateDeliveredSupply?: Record<string, number>;
  /**
   * Fraction of each state's physical-input demand delivered by the prior
   * freight settlement.  The corporation turn uses this as a lagged local
   * throughput constraint when settlement is active.
   */
  stateInputAvailability?: Record<string, number>;
  /**
   * Units of each state's OWN production that found a buyer this turn: the
   * local fill plus everything the freight network carried out. The residual
   * (stateSupply minus this) is production that physically could not be
   * placed, which is the number the sell side has to see so a seller is not
   * credited with output no network could deliver.
   */
  statePlacedSupply?: Record<string, number>;
  /**
   * The part of a state's unplaced production that failed to reach a WILLING
   * buyer, as opposed to having no buyer at all.
   *
   * Deliberately not `stateSupply - statePlacedSupply`: that difference also
   * contains plain glut, and the two carry opposite instructions. A glut says
   * cut output; a delivery failure says the goods were wanted and could not
   * get there. Attribution rule, per commodity per turn: if any buyer is still
   * short when the sourcing pass ends, `min(1, residualUnmet / totalSpare)` of
   * every seller state's leftover spare is delivery-limited; if no buyer is
   * short, none of it is. Only this field may drive delivery-shaped copy on a
   * player surface.
   */
  stateDeliveryLimitedSupply?: Record<string, number>;
  /** Per-country aggregate prices: countryId -> price (computed with NATIONAL_COMMODITY_STABILIZER) */
  nationalPrices?: Record<string, number>;
  /** Per-country aggregate supply: countryId -> units/day (raw, before stabilizer) */
  nationalSupply?: Record<string, number>;
  /** Per-country aggregate demand: countryId -> units/day (raw, before stabilizer) */
  nationalDemand?: Record<string, number>;
  /** Game turn number when this was last updated */
  turn: number;
  /** Admin-set one-turn price override — applied then cleared by commodityPriceTurn.ts */
  nudgePrice?: number | null;
  /** Turn when nudgePrice was set (for staleness detection) */
  nudgeTurn?: number | null;
  /** Global hard peg — price locked to this value each turn until explicitly removed */
  hardPeg?: number | null;
  /** Per-state hard pegs — state price locked until removed. Key: stateId, Value: price */
  stateHardPegs?: Record<string, number>;
  /** Per-state one-shot nudges — sets state price then cleared. Key: stateId, Value: price */
  stateNudges?: Record<string, number>;
  /**
   * Scarcity-drift multiplier (persistent-imbalance integrator). Scales the
   * commodity's base price before the level formula each turn while
   * `commodityScarcityDriftEnabled` is on; 1 when off or balanced. See
   * src/lib/market/scarcityDrift.ts.
   */
  scarcityMult?: number;
  /**
   * Per-country scarcity-drift multipliers advanced on each country's
   * REACHABLE book (ticket #1077 follow-up). A country behind an embargo wall
   * integrates its own shortage instead of inheriting the planet's aggregate —
   * the global `scarcityMult` above stays the world-aggregate integrator for
   * the global price leg and charts. Empty/absent when drift is off or the
   * world has never run the partitioned pass.
   */
  scarcityMultByCountry?: Record<string, number>;
  /**
   * Per-country reachable-market price (the wide leg of the state blend),
   * persisted so lagged consumers — clearing's price-realization factor —
   * can read the price of the market a seller actually clears in rather than
   * the worldwide `globalPrice`. Pegs/nudges override to the pegged value.
   */
  reachablePrices?: Record<string, number>;
  updatedAt: Date;
}
