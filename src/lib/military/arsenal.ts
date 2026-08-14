import type { CorporateSector } from "@/lib/db/types/corporation";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import type { MilitaryUnit, UnitEquipment } from "@/lib/db/types/militaryUnit";
import type { CountryId } from "@/lib/constants/countries";
import { MILITARY_COUNTRY_SCALE } from "@/lib/constants/military";
import { ARCHETYPE_COST_GDP_DIVISOR } from "./procurement";

/**
 * The per-track equipment ceiling a fully-supplied unit reaches.
 *
 * Not arbitrary. The seeder already generates equipment in the 0–2 band
 * (`seedMilitaryUnits.ts:151`) and `computeEffectivePower` multiplies by
 * `(1 + eqAvg × 0.03)`, so a ceiling of 3 makes a fully-kitted unit ~9% stronger than a bare
 * one — the same order as a veterancy step, which is the intended weight. Raising it
 * re-balances combat and is out of scope for the arsenal.
 */
export const EQUIPMENT_TRACK_MAX = 3;

/** Highest `techTier` a delivered unit can carry, matching `MilitaryUnit.techTier`. */
const MAX_TIER = 3;

/**
 * How many lots of materiel a unit of this archetype needs to be fully equipped.
 *
 * Scaled off `archetype.cost`, the same figure procurement prices against, so an armoured
 * division needs proportionally more materiel than an infantry one without a second cost
 * table to keep in sync.
 *
 * `LOT_COST_UNITS` and `procurement.LOT_COST_SHARE` are ONE dial expressed as two numbers —
 * how many lots a unit needs, and what a lot costs. They are calibrated together against a
 * single target (what share of C1's post-upkeep procurement remainder a fully-equipped seeded
 * roster should consume), never tuned against each other. See `scripts/calibrate-arsenal.ts`.
 */
export const LOT_COST_UNITS = ARCHETYPE_COST_GDP_DIVISOR / 1_000; // 387 cost units per lot

export function lotsRequired(archetype: { cost: number }): number {
  return Math.max(1, Math.round(archetype.cost / LOT_COST_UNITS));
}

/**
 * The share of a unit's purchase price that its full load of materiel costs. THE one dial —
 * `LOT_COST_UNITS` above and `LOT_COST_SHARE` below are both derived from it, never tuned
 * against each other.
 *
 * At 0.35 a fully-equipped formation's kit costs about a third of what the platform itself
 * cost to build, leaving the balance as hulls, airframes and personnel. Measured against the
 * C1 board: the US nets ~$300M/turn after upkeep and a lot prices at ~$352M, so materiel
 * accrues at roughly one lot per turn — an infantry division's four lots take about five
 * turns to fill, and equipping a from-scratch national roster is a game-year project rather
 * than an afternoon's.
 */
export const MATERIEL_SHARE_OF_UNIT_COST = 0.35;

/**
 * Price of one lot as a fraction of the country's anchored GDP, before its cost scale.
 *
 * Falls out of the two constants above and is deliberately ARCHETYPE-INDEPENDENT. Given
 * `lots = cost / LOT_COST_UNITS` and a target materiel cost of
 * `MATERIEL_SHARE × anchor × (cost / ARCHETYPE_COST_GDP_DIVISOR) × scale`, the `cost` term
 * cancels: a lot is a lot, and a tank's worth of materiel costs the same whether it goes into
 * a tank or a frigate. Only how MANY lots a platform needs varies.
 */
export const LOT_COST_SHARE = MATERIEL_SHARE_OF_UNIT_COST / 1_000;

/**
 * What a country pays per lot, in the same units as its defence appropriation.
 *
 * Priced off the ANCHORED gdp (C1's `militaryPriceAnchor`) rather than live GDP, so contract
 * prices inherit the same property unit prices have: a growing economy outruns them instead
 * of cancelling against them. Returns null on an unusable GDP, and callers must refuse rather
 * than treat it as free — the same rule `unitPurchasePrice` enforces.
 */
export function lotPrice(countryId: string, anchoredGdp: number | null): number | null {
  if (anchoredGdp == null || !(anchoredGdp > 0)) return null;
  const scale = MILITARY_COUNTRY_SCALE[countryId as CountryId] ?? 1;
  return Math.max(1, Math.round(anchoredGdp * LOT_COST_SHARE * scale));
}

/**
 * What a newly-raised unit is issued, given what the arsenal could actually provide.
 *
 * **Grade and fill are orthogonal, deliberately.** `grade` — what the country's industry can
 * BUILD — sets `techTier`. `fill` — how much ARRIVED — scales the equipment tracks. A nation
 * with advanced industry but no throughput fields good-tier units with empty racks; one with
 * mass production but no R&D fields fully-kitted obsolete ones. Collapsing the two into a
 * single quality number would lose exactly the distinction the arsenal exists to express.
 *
 * An empty arsenal yields a hollow formation — real personnel, no kit — rather than refusing
 * the order. Scarcity degrades quality and speed; it never presents a dead button.
 */
export function equipUnit(
  lotsDrawn: number,
  lotsNeeded: number,
  grade: number
): { techTier: 0 | 1 | 2 | 3; equipment: UnitEquipment } {
  // A zero requirement counts as fully supplied: there is nothing outstanding to issue, and
  // dividing by it would be the only way this function could throw.
  const fill = lotsNeeded > 0 ? Math.min(1, Math.max(0, lotsDrawn / lotsNeeded)) : 1;
  const track = Math.round(EQUIPMENT_TRACK_MAX * fill);

  // Tier is the grade of the materiel RECEIVED, so nothing received means no tier — even
  // when the store still reports a grade. Drawing does not lower `grade`, so a drained
  // arsenal keeps its last value; without this guard a unit issued zero lots would be
  // stamped at that grade and collect `techPowerMult()` in combat for kit it never got.
  // Partial fills DO keep the full tier: a half-equipped unit still has modern equipment,
  // just not enough of it, which is the grade/fill distinction this function exists to make.
  const tier = (fill > 0 ? Math.min(MAX_TIER, Math.max(0, Math.round(grade))) : 0) as 0 | 1 | 2 | 3;
  return {
    techTier: tier,
    equipment: { firepower: track, protection: track, support: track },
  };
}

/**
 * The store's new mean grade after a delivery, weighted by volume.
 *
 * Delivering better materiel raises what the store can issue; drawing from it does not change
 * the average. Guards the empty-store case, where the incoming grade simply becomes the
 * store's.
 */
export function blendGrade(
  stock: number,
  grade: number,
  incomingLots: number,
  incomingGrade: number
): number {
  const total = Math.max(0, stock) + Math.max(0, incomingLots);
  if (total <= 0) return 0;
  return (Math.max(0, stock) * grade + Math.max(0, incomingLots) * incomingGrade) / total;
}

/** Mean of a unit's three equipment tracks, tolerating a legacy unit with none. */
function eqAvgOf(unit: Pick<MilitaryUnit, "equipment">): number {
  const e = unit.equipment;
  if (!e) return 0;
  return ((e.firepower ?? 0) + (e.protection ?? 0) + (e.support ?? 0)) / 3;
}

/** How many more lots this unit needs to reach a full load of `lotsNeeded`. */
export function lotsToFillUnit(unit: Pick<MilitaryUnit, "equipment">, lotsNeeded: number): number {
  const shortfall = 1 - eqAvgOf(unit) / EQUIPMENT_TRACK_MAX;
  return Math.max(0, Math.round(lotsNeeded * shortfall));
}

/**
 * The order to refit a force in: nearest-to-complete first.
 *
 * With scarce stock this produces some combat-worthy formations rather than raising every
 * unit a little and leaving none of them effective — the same reasoning `reinforceUnit` uses
 * for manpower. Returns a new array; callers iterate it while draining the store.
 */
export function refitOrder<T extends Pick<MilitaryUnit, "equipment">>(units: T[]): T[] {
  return [...units].sort((a, b) => eqAvgOf(b) - eqAvgOf(a));
}

/**
 * Lots a plant produces this turn, from the commodities its strategy actually supplies.
 *
 * Uses the same `units = revenue × rate / basePrice` identity the commodity market uses, so a
 * plant's military output and its market output come from one production model rather than
 * two that can drift apart.
 *
 * Deliberately reads the NAMEPLATE `revenue`, not `realizedRevenue`. Delivering to an arsenal
 * now diverts output away from the market, which lowers realized revenue — so basing military
 * capacity on the realized figure would make the plant's output an input to its own
 * diversion. A fully-contracted plant would oscillate: deliver everything, earn nothing,
 * therefore produce nothing, therefore deliver nothing, therefore earn again. Nameplate is
 * the plant's standing capability and the diversion leg does not touch it.
 */
/**
 * A plant's materiel output as a fractional lot count, BEFORE flooring to whole lots.
 *
 * Delivery accumulates this remainder across turns (see `applyDefenceDeliveries`), so a small
 * plant producing well under one lot per turn still fills an order eventually rather than
 * having its sub-lot output silently discarded every turn.
 */
export function rawLotsFromSector(sector: Pick<CorporateSector, "strategyId" | "revenue">): number {
  const strategy = SECTOR_STRATEGIES.defense.find(
    (s) => s.id === (sector.strategyId ?? "standard")
  );
  if (!strategy) return 0;
  const revenue = sector.revenue ?? 0;
  if (revenue <= 0) return 0;

  let total = 0;
  for (const [commodity, rate] of Object.entries(strategy.supply)) {
    const base = COMMODITY_BASE_PRICES[commodity as CommodityType] ?? 1;
    total += (revenue * (rate as number)) / base;
  }
  return total;
}

export function lotsFromSector(sector: Pick<CorporateSector, "strategyId" | "revenue">): number {
  return Math.floor(rawLotsFromSector(sector));
}

/**
 * The share of a plant's output (0..1) that `lots` delivered represents.
 *
 * Written to the sector at delivery and read back as a realization leg on both the cash
 * (`sectorTurn`) and the goods (`computeRawSupplyDemand`). Clamped to 1: a multi-domain
 * plant splits its output per component, so several contracts on one plant can never divert
 * more than everything it makes.
 */
export function militaryDivertedShare(
  sector: Pick<CorporateSector, "strategyId" | "revenue">,
  lots: number
): number {
  const output = lotsFromSector(sector);
  if (!(output > 0) || !(lots > 0)) return 0;
  return Math.min(1, lots / output);
}

/**
 * The diversion share still in force for a sector this turn, or 0.
 *
 * Deliveries land AFTER commodity pricing in the turn order, so the stamp is always read a
 * turn later than it was written — hence `>= currentTurn - 1` rather than equality. Anything
 * older is a contract that has completed, been cancelled, or a plant that simply delivered
 * nothing, and it expires without a cleanup pass having to find it.
 *
 * Shared by both read sites on purpose: if the cash leg and the goods leg disagreed about
 * what counts as fresh, a plant would lose revenue for output the world still received.
 */
export function freshMilitaryDiversion(
  sector: Pick<CorporateSector, "militaryDivertedFraction" | "militaryDivertedTurn">,
  currentTurn: number
): number {
  const f = sector.militaryDivertedFraction;
  const t = sector.militaryDivertedTurn;
  if (typeof f !== "number" || !Number.isFinite(f) || f <= 0) return 0;
  if (typeof t !== "number" || !Number.isFinite(t)) return 0;
  if (t < currentTurn - 1) return 0;
  return Math.min(1, Math.max(0, f));
}
