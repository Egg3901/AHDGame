/**
 * Per-sector inventory of unsold storable output (supply-dislocation
 * remediation phase 3; design-realization-legs section 6, v1 flat-cost model).
 *
 * Before this, the `(1 - soldFraction)` unsold remainder of a sector's output
 * simply evaporated each turn (~6.5M units/day world-wide at t202). With the
 * per-sector `stockpileUnsold` toggle ON, the unsold remainder of each
 * STORABLE output becomes sector inventory instead, and inventory sells down
 * in later turns when the market clears the sector's fresh output in full — a
 * glut becomes an asset realized later, not lost money.
 *
 * v1 economics, per the confirmed design decisions (2026-07-10):
 * - Player toggle, default OFF (sell-all = existing behavior; NPP corps do not
 *   stockpile).
 * - Storable outputs only: spoilage reuses COMMODITY_SPOILAGE_PER_TURN, so
 *   services can never stockpile and raw materials carry cheaply.
 * - Flat carrying cost per turn as a share of inventory value. Carry plus
 *   spoilage make indefinite hoarding lose money against selling; the
 *   freight/warehousing-coupled cost is the designed v2 and this function is
 *   deliberately swappable without a schema change.
 * - Sell-down only when the sector's fresh output FULLY cleared this turn
 *   (demand exhausted the offer), capped at a fraction of the pile per turn.
 *   Drained units are valued at the sector's mix price with no bonus legs —
 *   old stock does not earn this turn's premiums.
 *
 * Pure module: sectorTurn feeds it and persists the result; the net cash
 * effect rides the sector's normal revenue/cost rails (taxed and aggregated
 * exactly like operating income).
 */

import type { CommodityType } from "@/lib/constants/commodities";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import { COMMODITY_SPOILAGE_PER_TURN, isStorable } from "@/lib/market/inventory";

/** Fraction of the pile that may sell down in one fully-cleared turn. */
export const INVENTORY_DRAIN_RATE_PER_TURN = 0.25;

/** Flat carrying cost per turn, as a share of inventory value at mix price. */
export const INVENTORY_CARRY_COST_RATE_PER_TURN = 0.005;

/** soldFraction at or above this counts as "the fresh offer fully cleared". */
export const INVENTORY_SELL_DOWN_MIN_FILL = 0.98;

/** Piles below this many units are cleared to zero (float dust guard). */
const INVENTORY_EPSILON = 0.01;

export interface InventoryTurnInput {
  /** Current pile, units per commodity (daily unit basis, same as producedUnits). */
  inventory: Partial<Record<CommodityType, number>>;
  /** The sector's stockpile toggle. */
  stockpileEnabled: boolean;
  /** This turn's produced/sold units (daily basis). */
  producedUnits: number;
  soldUnits: number;
  /** This turn's blended sold fraction; null when clearing did not run. */
  soldFraction: number | null;
  /** Per-commodity sold fractions behind the blend, when clearing wrote them. */
  soldByCommodity: Partial<Record<string, number>>;
  /** The sector's output mix rates (strategy supply: commodity → revenue rate). */
  supplyRates: Partial<Record<CommodityType, number>>;
  /** ₳ per output unit at mix prices (sectorTurn's plantsMixPrice). */
  mixPriceAnchor: number;
}

export interface InventoryTurnResult {
  /** The pile after accrual, spoilage, and sell-down. */
  nextInventory: Partial<Record<CommodityType, number>>;
  /** Units added from this turn's unsold storable output. */
  accruedUnits: number;
  /** Units lost to spoilage this turn. */
  spoiledUnits: number;
  /** Units sold down into the cleared market this turn. */
  drainedUnits: number;
  /** ₳ earned by the sell-down (daily basis, mix price, no bonus legs). */
  drainedRevenueAnchor: number;
  /** ₳ carrying cost on the pile held this turn (daily basis). */
  carryCostAnchor: number;
  /** Total units held after the turn. */
  heldUnits: number;
  /** ₳ value of the held pile at mix price (display/telemetry). */
  heldValueAnchor: number;
}

/**
 * Unit share of each output commodity in one blended output unit: the same
 * `rate/base` decomposition `unitYieldForSupply` sums, normalized to 1.
 */
function unitShares(
  supplyRates: Partial<Record<CommodityType, number>>
): Array<{ commodity: CommodityType; share: number }> {
  const parts: Array<{ commodity: CommodityType; share: number }> = [];
  let total = 0;
  for (const commodity of Object.keys(supplyRates ?? {}) as CommodityType[]) {
    const rate = supplyRates[commodity] ?? 0;
    const base = COMMODITY_BASE_PRICES[commodity];
    if (rate > 0 && base > 0) {
      const weight = rate / base;
      parts.push({ commodity, share: weight });
      total += weight;
    }
  }
  if (total <= 0) return [];
  for (const p of parts) p.share /= total;
  return parts;
}

export function advanceSectorInventory(input: InventoryTurnInput): InventoryTurnResult {
  const {
    inventory,
    stockpileEnabled,
    producedUnits,
    soldUnits,
    soldFraction,
    soldByCommodity,
    supplyRates,
    mixPriceAnchor,
  } = input;

  const next: Partial<Record<CommodityType, number>> = {};
  let spoiledUnits = 0;
  let drainedUnits = 0;
  let accruedUnits = 0;

  // The pile can sell down only into a market that cleared the sector's whole
  // fresh offer — selling into a partially-cleared market would jump the queue
  // past the sector's own unsold production.
  const fullyCleared = soldFraction != null && soldFraction >= INVENTORY_SELL_DOWN_MIN_FILL;

  // 1. Spoil, then drain, the existing pile (both apply while the toggle is
  // off too: turning the toggle off stops ACCRUAL, it does not freeze physics
  // or hold a dead pile forever).
  for (const [commodity, held] of Object.entries(inventory ?? {}) as Array<
    [CommodityType, number]
  >) {
    if (!(held > 0)) continue;
    const spoilage = COMMODITY_SPOILAGE_PER_TURN[commodity] ?? 1;
    let remaining = held * (1 - spoilage);
    spoiledUnits += held - remaining;
    if (fullyCleared && remaining > 0) {
      const drain = remaining * INVENTORY_DRAIN_RATE_PER_TURN;
      drainedUnits += drain;
      remaining -= drain;
    }
    if (remaining > INVENTORY_EPSILON) next[commodity] = remaining;
  }

  // 2. Accrue this turn's unsold storable output (toggle on, clearing ran).
  const unsoldTotal = Math.max(0, producedUnits - soldUnits);
  if (stockpileEnabled && soldFraction != null && unsoldTotal > 0) {
    for (const { commodity, share } of unitShares(supplyRates)) {
      if (!isStorable(commodity)) continue;
      // Per-commodity unsold when clearing itemized it; blended fallback.
      const commoditySold = soldByCommodity[commodity];
      const unsold =
        typeof commoditySold === "number"
          ? producedUnits * share * Math.max(0, 1 - commoditySold)
          : unsoldTotal * share;
      if (unsold > 0) {
        accruedUnits += unsold;
        next[commodity] = (next[commodity] ?? 0) + unsold;
      }
    }
  }

  let heldUnits = 0;
  for (const held of Object.values(next)) heldUnits += held ?? 0;

  return {
    nextInventory: next,
    accruedUnits,
    spoiledUnits,
    drainedUnits,
    drainedRevenueAnchor: drainedUnits * mixPriceAnchor,
    carryCostAnchor: heldUnits * mixPriceAnchor * INVENTORY_CARRY_COST_RATE_PER_TURN,
    heldUnits,
    heldValueAnchor: heldUnits * mixPriceAnchor,
  };
}
