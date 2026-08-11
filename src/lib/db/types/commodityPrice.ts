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
  /** Global demand in units/day */
  globalDemand: number;
  /** Per-state prices: stateId -> price */
  statePrices: Record<string, number>;
  /** Per-state supply: stateId -> units/day */
  stateSupply: Record<string, number>;
  /** Per-state demand: stateId -> units/day */
  stateDemand: Record<string, number>;
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
  updatedAt: Date;
}
