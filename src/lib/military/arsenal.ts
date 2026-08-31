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
 * `LOT_COST_UNITS` and `LOT_COST_SHARE` are ONE dial expressed as two numbers: how many lots
 * a unit needs, and what a lot costs. Both fall out of `MATERIEL_SHARE_OF_UNIT_COST` against a
 * single target, what share of a country's post-upkeep procurement remainder a fully-equipped
 * roster consumes. Never tune them against each other.
 *
 * The division of labour between them, because it is not obvious and getting it wrong wastes a
 * day:
 *
 * - The `1_000` they share is pure GRANULARITY, and it is scale-invariant. Doubling it halves
 *   the lot price and doubles the lots a platform needs. Money per unit is unchanged and
 *   time-to-equip is unchanged, because a unit needs twice as many lots that arrive twice as
 *   fast. It cannot move pacing, only how finely materiel is diced.
 * - `MATERIEL_SHARE_OF_UNIT_COST` is the ONLY lever that moves PACING. A unit's materiel bill
 *   is that share of its price and the procurement budget per turn is fixed, so time-to-equip
 *   is directly proportional to it.
 *
 * Verify a change against the live world rather than by eye: the `arsenal pacing` block in
 * `arsenal.test.ts` pins the US case (procurement per turn, lot price, lots per turn) to the
 * measured production figures, which is the same target this calibration was always aimed at.
 */
export const LOT_COST_UNITS = ARCHETYPE_COST_GDP_DIVISOR / 1_000; // 387 cost units per lot

export function lotsRequired(archetype: { cost: number }): number {
  return Math.max(1, Math.round(archetype.cost / LOT_COST_UNITS));
}

/**
 * The share of a unit's purchase price that its full load of materiel costs. THE one dial -
 * `LOT_COST_UNITS` above and `LOT_COST_SHARE` below are both derived from it, never tuned
 * against each other.
 *
 * At 0.20 a fully-equipped formation's kit costs a fifth of what the platform itself cost to
 * build, leaving the balance as hulls, airframes and personnel.
 *
 * Lowered from 0.35 in ticket #1134. This is the ONLY lever that moves arsenal PACING: a
 * unit's materiel bill is this share of its price, the procurement budget per turn is fixed,
 * so time-to-equip is directly proportional to it. The lot-granularity divisor the two derived
 * constants share cannot do it - halving it halves the lot price and doubles the lots a
 * platform needs, which is scale-invariant and changes nothing.
 *
 * Measured against the C1 board and the live world, which agree: the US nets ~383.7M/turn of
 * procurement after upkeep, a lot priced at 0.35 costs 383.7M, and the observed contracting
 * window is 12 lots over 12 turns - exactly the one lot per turn the 0.35 calibration
 * targeted. At 0.20 a lot prices at 219.3M and the same budget accrues 1.75 lots per turn, so
 * an infantry division's four lots take about 2.3 turns instead of 4 and equipping a
 * from-scratch national roster takes about 27 turns instead of a full 48-turn game year.
 * Deliberately a modest step, not a collapse: procurement money still constrains how fast an
 * army can be re-equipped, which is the property the original calibration existed to create.
 */
export const MATERIEL_SHARE_OF_UNIT_COST = 0.2;

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
  const track = EQUIPMENT_TRACK_MAX * fill;

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
  // Lots are indivisible. Rounding to nearest understated the final requirement for an
  // unevenly-equipped unit: a Marine Division at 3/2/3 was shown as needing one lot even
  // though its exact shortfall was 1.33. The minister then ordered the displayed amount and
  // quite reasonably saw the same warning after it was issued. A tiny epsilon prevents a
  // floating-point residue at an exact boundary from inventing an extra lot.
  return Math.max(0, Math.ceil(lotsNeeded * shortfall - Number.EPSILON * 16));
}

const EQUIPMENT_TRACKS = ["firepower", "protection", "support"] as const;

/**
 * Apply whole arsenal lots without discarding their sub-track equipment value.
 *
 * One lot carries `3 * EQUIPMENT_TRACK_MAX / fullLots` total equipment points. The old refit
 * path added one third of that value to every track and rounded each track immediately. A
 * one-lot Marine Division top-up therefore changed 2.25 back to 2, while the lot had already
 * been removed from the arsenal. Keeping fractional track values makes every paid lot
 * persistent; filling the lowest tracks first also redirects value that would otherwise be
 * thrown away against a track already at the ceiling.
 */
export function applyEquipmentLots(
  equipment: MilitaryUnit["equipment"],
  lotsDrawn: number,
  fullLots: number
): UnitEquipment {
  const out: UnitEquipment = {
    firepower: Math.min(EQUIPMENT_TRACK_MAX, Math.max(0, equipment?.firepower ?? 0)),
    protection: Math.min(EQUIPMENT_TRACK_MAX, Math.max(0, equipment?.protection ?? 0)),
    support: Math.min(EQUIPMENT_TRACK_MAX, Math.max(0, equipment?.support ?? 0)),
  };
  let points =
    (Math.max(0, lotsDrawn) / Math.max(1, fullLots)) *
    EQUIPMENT_TRACK_MAX *
    EQUIPMENT_TRACKS.length;

  while (points > Number.EPSILON) {
    const incomplete = EQUIPMENT_TRACKS.filter((track) => out[track] < EQUIPMENT_TRACK_MAX);
    if (incomplete.length === 0) break;

    const floor = Math.min(...incomplete.map((track) => out[track]));
    const lowest = incomplete.filter((track) => Math.abs(out[track] - floor) < Number.EPSILON * 16);
    const nextLevel = Math.min(
      EQUIPMENT_TRACK_MAX,
      ...incomplete.filter((track) => out[track] > floor).map((track) => out[track])
    );
    const capacity = (nextLevel - floor) * lowest.length;

    if (points >= capacity - Number.EPSILON) {
      for (const track of lowest) out[track] = nextLevel;
      points -= capacity;
      continue;
    }

    const increment = points / lowest.length;
    for (const track of lowest) out[track] = floor + increment;
    points = 0;
  }

  for (const track of EQUIPMENT_TRACKS) {
    out[track] = Math.round(out[track] * 1e12) / 1e12;
  }
  return out;
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

/**
 * What share of a unit's full materiel load it costs to repair it from nothing.
 *
 * Expressed against the existing lot economy rather than as a fresh price, so it inherits
 * `LOT_COST_UNITS`' calibration instead of adding a second thing to keep in sync. At 0.5 a
 * wrecked hull costs half of what fully equipping one does: more than a top-up, which is
 * worth at most a few percent of combat power, and well under a new platform, because the
 * hull already exists and only has to be made seaworthy again.
 *
 * This is the pacing dial for paid repair. The calibration target is that a major navy can
 * return roughly one crippled hull per turn or two without starving its refit pipeline,
 * since repair draws from the same per-domain store.
 */
export const REPAIR_LOT_SHARE = 0.5;

/**
 * Lots of materiel needed to restore one formation to full condition.
 *
 * Rounded UP for the same reason `lotsToFillUnit` is: lots are indivisible, and rounding
 * to nearest understates the requirement, so a minister orders the displayed amount and
 * then sees the same shortfall afterwards.
 */
export function lotsToRepair(unit: { integrity?: number }, lotsFull: number): number {
  const damage = (100 - (unit.integrity ?? 100)) / 100;
  if (damage <= 0) return 0;
  return Math.max(1, Math.ceil(lotsFull * damage * REPAIR_LOT_SHARE));
}

/**
 * Repair order: worst damaged first.
 *
 * The mirror image of `refitOrder`, and deliberately so. Refit tops up the nearest to
 * complete because a partly equipped unit is already fighting; repair goes to the worst
 * hull because a wreck contributes literally nothing until it is seaworthy, so the
 * marginal combat value of a lot is highest at the bottom.
 */
export function repairOrder<T extends { integrity?: number }>(units: T[]): T[] {
  return [...units].sort((a, b) => (a.integrity ?? 100) - (b.integrity ?? 100));
}
