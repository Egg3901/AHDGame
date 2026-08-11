import type { CommodityType } from "@/lib/constants/commodities";

/**
 * Shadow commodity inventory — Tier 2 of the structural market rework
 * (audit t806, Fix 3; see docs/plans/2026-07-03-market-structural-plan.md).
 *
 * Each price turn (marketSystemMode >= "ledger") the global stock of every
 * storable commodity accumulates its net flow: `stock += supply − demand`,
 * floored at 0, then decays by the commodity's per-turn carry/spoilage rate.
 * SHADOW ONLY: stock and days-of-cover are recorded on the flow ledger and
 * shown to players, but do NOT feed prices yet — the stock-to-flow price
 * curve lands with the "clearing" tier, where behaviour changes are expected.
 */

/**
 * Per-turn fraction of stock lost to spoilage/carry. 1 = non-storable
 * (services evaporate; energy without grid-scale storage in this era).
 * Turns are hourly game-days ×24, so these are deliberately small.
 */
export const COMMODITY_SPOILAGE_PER_TURN: Record<CommodityType, number> = {
  // Non-storable: services and era-appropriate un-storables.
  energy: 1,
  construction_services: 1,
  healthcare_services: 1,
  real_estate_services: 1,
  financial_services: 1,
  consulting_services: 1,
  network_services: 1,
  entertainment_services: 1,
  advertising: 1,
  freight: 1,
  retail: 1,
  software: 0, // infinitely copyable once built; stock is licenses, not crates
  // Perishable goods.
  food: 0.04,
  pharmaceuticals: 0.01,
  // Storable bulk & durable goods: small carry loss.
  steel: 0.002,
  electronics: 0.005, // obsolescence
  chemicals: 0.005,
  fertilizers: 0.005,
  building_materials: 0.002,
  vehicles: 0.003, // lot depreciation
  iron: 0.001,
  coal: 0.001,
  oil: 0.001,
  rare_earth: 0.001,
  timber: 0.003,
  natural_gas: 0.01, // storage boil-off/leakage
  ordnance: 0.002,
  plastics: 0.002,
};

/**
 * Legacy-stockpile overhang defusal (turn ~900 balance pass): maximum turns
 * of demand a commodity's stock may cover before accelerated spoilage kicks
 * in. Stock above `cap × current demand` was accumulated under pre-clearing
 * rules and is a market-flooding weapon / silent value store the new rules
 * never priced; instead of confiscating it, the excess spoils faster.
 * Config-gated off `gameConfig.stockCoverCapEnabled` (default OFF).
 */
export const STOCK_COVER_CAP_TURNS = 400;

/**
 * Per-turn fraction of the ABOVE-CAP excess lost to accelerated spoilage,
 * applied on top of the commodity's base carry rate. 2%/turn of the excess
 * is a geometric drawdown: steel's ~840M-unit overhang (1.22B stock vs a
 * 380M cap at 950k/turn demand) sheds ~17M units on the first turn and
 * halves roughly every 35 turns — a multi-fiscal-year unwind, not a
 * detonation.
 */
export const EXCESS_STOCK_SPOILAGE_RATE = 0.02;

/** True when a commodity can hold stock at all. */
export function isStorable(commodity: CommodityType): boolean {
  return COMMODITY_SPOILAGE_PER_TURN[commodity] < 1;
}

/**
 * Advance one commodity's stock by one turn.
 * Returns the new stock plus the spoilage taken, both in units.
 * Non-storable commodities always return stock 0.
 *
 * When `coverCapEnabled` (gameConfig.stockCoverCapEnabled), stock left above
 * STOCK_COVER_CAP_TURNS × demand after base spoilage takes an ADDITIONAL
 * EXCESS_STOCK_SPOILAGE_RATE hit on the excess only. The extra loss is folded
 * into `spoiledUnits` (so total write-down stays in one place) and also broken
 * out as `excessSpoiledUnits` so the flow ledger records the write-down
 * explicitly. Skipped when demand is 0: cover is undefined there, and a
 * transient demand blackout must not vaporise the whole stockpile.
 *
 * PLANTS (`producedUnits`/`soldUnits` both supplied): the flow is stated in
 * terms of physical goods rather than the supply/demand aggregate —
 *
 *   netFlow = unsold − unmetDemand
 *           = (produced − sold) − max(0, demand − sold)
 *
 * i.e. goods that were made but did not clear go INTO the pile (this is where
 * unsold output used to simply vanish), and demand that no producer met is
 * drawn OUT of it. Sign convention is unchanged: positive flow raises stock.
 *
 * Because clearing can never sell more than was produced nor more than was
 * demanded, this is arithmetically identical to `supply − demand` whenever the
 * produced figure equals the ledger's supply figure — which, once the world
 * ledger reads real production, it does. Magnitudes therefore do not move; the
 * value of stating it this way is that the stock account now names the physical
 * quantity it is tracking, so a future tier that lets sellers withhold output
 * from the book gets the right answer without another rewrite.
 */
export function advanceStock(args: {
  commodity: CommodityType;
  prevStock: number;
  supplyUnits: number;
  demandUnits: number;
  coverCapEnabled?: boolean;
  /** Plants: units physically produced this turn (defaults to the flow model). */
  producedUnits?: number | null;
  /** Plants: units that actually cleared this turn. */
  soldUnits?: number | null;
}): { stock: number; spoiledUnits: number; excessSpoiledUnits: number } {
  const { commodity, prevStock, supplyUnits, demandUnits, coverCapEnabled } = args;
  const spoilRate = COMMODITY_SPOILAGE_PER_TURN[commodity] ?? 1;
  if (spoilRate >= 1) return { stock: 0, spoiledUnits: 0, excessSpoiledUnits: 0 };
  const safePrev = Number.isFinite(prevStock) && prevStock > 0 ? prevStock : 0;
  const usePhysical =
    typeof args.producedUnits === "number" &&
    Number.isFinite(args.producedUnits) &&
    typeof args.soldUnits === "number" &&
    Number.isFinite(args.soldUnits);
  const netFlow = usePhysical
    ? Math.max(0, (args.producedUnits as number) - (args.soldUnits as number)) -
      Math.max(0, demandUnits - (args.soldUnits as number))
    : supplyUnits - demandUnits;
  const afterFlow = Math.max(0, safePrev + netFlow);
  const baseSpoiled = afterFlow * spoilRate;
  let stock = afterFlow - baseSpoiled;
  let excessSpoiledUnits = 0;
  if (coverCapEnabled === true && demandUnits > 0) {
    const capUnits = STOCK_COVER_CAP_TURNS * demandUnits;
    const excess = Math.max(0, stock - capUnits);
    excessSpoiledUnits = excess * EXCESS_STOCK_SPOILAGE_RATE;
    stock -= excessSpoiledUnits;
  }
  return {
    stock: Math.round(stock * 100) / 100,
    spoiledUnits: Math.round((baseSpoiled + excessSpoiledUnits) * 100) / 100,
    excessSpoiledUnits: Math.round(excessSpoiledUnits * 100) / 100,
  };
}

/**
 * Days of cover: how many turns current stock would satisfy demand with no
 * production. null when the commodity is non-storable or has no demand.
 */
export function daysOfCover(
  commodity: CommodityType,
  stock: number,
  demandUnits: number
): number | null {
  if (!isStorable(commodity)) return null;
  if (!(demandUnits > 0)) return null;
  return Math.round((stock / demandUnits) * 10) / 10;
}
