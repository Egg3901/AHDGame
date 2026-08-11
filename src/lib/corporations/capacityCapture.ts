/**
 * Attacks and market splits as CAPACITY transfers (plants tier).
 *
 * Under `marketSystemMode >= "plants"` a sector's `revenue` is RESTATED from
 * `capitalStock × mixPrice` by the turn processor every turn. Any other writer
 * that `$inc`s `revenue` is therefore either erased on the next turn (the
 * attacker never keeps what it took) or, worse, double-counted for one turn
 * against capacity that never moved. The attack/split paths were exactly that:
 * two revenue `$inc`s and a revenue-seeded new sector.
 *
 * This module holds the plants translation shared by the two player routes and
 * the NPP attack runner, so the three can never disagree:
 *
 *   1. the ₳ capture the existing (unchanged) capture math produces is turned
 *      into CAPACITY UNITS at the DEFENDER's production mix — the defender is
 *      the side losing physical plant, so its mix is the one that prices it;
 *   2. the defender loses all of those units;
 *   3. the attacker receives only {@link ATTACK_CAPTURE_EFFICIENCY} of them;
 *   4. the attacker pays at least the build price of what it receives, times
 *      {@link ATTACK_BUILD_PRICE_PREMIUM}, so capture is never a cheap
 *      substitute for building.
 *
 * Nothing here runs below the plants tier: every caller keeps its legacy ₳
 * revenue path byte-identical behind a mode check.
 */

import type { CorporationType } from "@/lib/constants/corporations";
import {
  ATTACK_BUILD_PRICE_PREMIUM,
  ATTACK_CAPTURE_EFFICIENCY,
  capacityPricePerUnit,
  revenuePerCapacityUnitForStrategy,
} from "@/lib/constants/capacityEconomy";
import { computeSectorImpliedUnits } from "@/lib/market/unownedHeadroom";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/**
 * World year for build pricing, resolved the same way `buildCapacity` does
 * (explicit `currentYear` when the game state carries one, else derived from
 * the turn counter).
 */
export function resolveWorldYear(
  currentYear: number | null | undefined,
  currentTurn: number | null | undefined
): number {
  if (typeof currentYear === "number" && Number.isFinite(currentYear)) return currentYear;
  const turn = typeof currentTurn === "number" && Number.isFinite(currentTurn) ? currentTurn : 0;
  return STARTING_YEAR + Math.floor((Math.max(1, turn) - 1) / TURNS_PER_YEAR);
}

/**
 * The ₳ quantity an attack is SIZED against, under plants.
 *
 * Every attack path (player route, NPP runner) used the defender's `revenue`
 * for three separate jobs: the minimum-target threshold, the contested amount,
 * and the attack price. Under plants `revenue` is what the market actually
 * cleared against the plant, scaled by the ramp — so it is not a measure of what
 * is there to take. Two failures followed, in opposite directions:
 *
 *   - a MOTHBALLED factory reports revenue 0, so it fell under every threshold
 *     and every `actualCapture <= 0` abort. A player could park capacity in
 *     mothball and it became permanently un-attackable while still counting as
 *     plant on the balance sheet and still restartable at will.
 *   - the same zero made `calculateAttackCostAnchor` return 0, so on any path
 *     that did let the attack through, seizing that capacity was FREE.
 *
 * The basis under plants is therefore the CAPACITY NAMEPLATE: the sector's built
 * `capitalStock` priced through its own strategy mix. That is precisely the
 * quantity `sectorTurn` restates `revenue` from before fill and ramp are applied,
 * so it is commensurable with the legacy basis, it is currency-free ₳ (no FX
 * enters), and it does not move when the market has a bad turn.
 *
 * Undelivered build orders are deliberately EXCLUDED: an attack seizes plant
 * that exists, not a construction contract the defender has paid for and not yet
 * received. Those stay with the defender.
 *
 * Returns `null` below plants, and for a sector with no capacity at all — both
 * mean "use the legacy revenue basis", which is the byte-identical path.
 */
export function attackCapacityBasisAnchor(
  sector: {
    sectorType: CorporationType;
    capitalStock?: number | null;
    strategyId?: string | null;
  },
  plantsEnabled: boolean,
  unitScale: number
): number | null {
  if (!plantsEnabled) return null;
  const stock =
    typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
      ? Math.max(0, sector.capitalStock)
      : 0;
  if (!(stock > 0)) return null;
  const anchor =
    stock * revenuePerCapacityUnitForStrategy(sector.sectorType, sector.strategyId, unitScale);
  return Number.isFinite(anchor) && anchor > 0 ? anchor : null;
}

/**
 * P5 — the PAID BASIS that moves with captured capacity.
 *
 * Book value is now what a corp actually SPENT on the capacity it holds, so an
 * attack has to move that basis alongside the units or the two sides stop
 * adding up: a defender that keeps its whole basis over fewer units books its
 * survivors at more than they cost (an exit mint), and an attacker that gains
 * units with no basis at all books free plant at zero (an exit theft).
 *
 * The rule is per-unit and symmetric. The defender loses
 * `unitsTaken / stock` of its basis; the attacker gains the share matching
 * `unitsReceived`. The difference — the `1 − ATTACK_CAPTURE_EFFICIENCY` that
 * the capture destroys — is basis DESTROYED with the plant it priced, which is
 * the same statement the units already make.
 *
 * The attacker's own attack payment is deliberately NOT added: the plants
 * attack price is floored at `build price × ATTACK_BUILD_PRICE_PREMIUM`, i.e.
 * ABOVE list, so booking it would make conquest a way to write capacity UP.
 * Attacking is a way to get plant you could not build, not a way to inflate
 * what you can sell it for.
 *
 * Returns `null` on either leg when the source carries no recorded basis (a
 * legacy row, or one the turn processor has not stamped yet). Callers must then
 * write NOTHING for that leg and let the list-price fallback stand — an `$inc`
 * against an absent field would materialise it and destroy the fallback.
 */
export function capacityCaptureBookTransfer(args: {
  /** Defender's recorded `capacityBookAnchor`, or null/undefined if it has none. */
  sourceBookAnchor: number | null | undefined;
  /** Defender's capacity BEFORE the capture. */
  sourceStock: number;
  unitsTaken: number;
  unitsReceived: number;
}): { bookRemovedFromSource: number; bookToAttacker: number } | null {
  const { sourceBookAnchor, sourceStock, unitsTaken, unitsReceived } = args;
  if (
    typeof sourceBookAnchor !== "number" ||
    !Number.isFinite(sourceBookAnchor) ||
    sourceBookAnchor < 0
  ) {
    return null;
  }
  if (!(Number.isFinite(sourceStock) && sourceStock > 0)) return null;
  const perUnit = sourceBookAnchor / sourceStock;
  const takenFraction = Math.max(0, Math.min(1, unitsTaken / sourceStock));
  const receivedUnits = Math.max(0, Math.min(unitsReceived, unitsTaken));
  return {
    bookRemovedFromSource: sourceBookAnchor * takenFraction,
    bookToAttacker: perUnit * receivedUnits,
  };
}

/**
 * The two `$set` fragments an owned-sector capture writes for the P5 paid basis
 * — one for the defender, one for the attacker's receiving sector.
 *
 * Written as absolute `$set`s, never `$inc`s: `capacityBookAnchor` is
 * OPTIONAL, and an `$inc` on a row that has none would materialise the field
 * and permanently replace the list-price fallback with a number that only
 * counts this one transaction.
 *
 * DEFENDER: touched only when it already carries a basis. A defender with none
 * keeps the fallback, which is `remaining stock × list price` — already exactly
 * pro-rata, because the stock itself went down.
 *
 * ATTACKER: always stamped, because doing nothing there is the mint. An
 * attacker with no basis would fall back to `(old + gained) × list`, booking
 * capacity it took by force at full list price. It is stamped at its own
 * pre-attack fallback (its pre-plants capacity really did cost list — identity
 * B) plus the basis that travelled with the captured plant.
 *
 * Returns empty fragments when the defender carries no basis AND has no stock
 * to price — there is then nothing meaningful to move.
 */
export function capacityCaptureBookUpdates(args: {
  defender: {
    sectorType: CorporationType;
    capitalStock?: number | null;
    capacityBookAnchor?: number | null;
  };
  /** Attacker's receiving sector; null when a brand-new sector is being created. */
  attacker: {
    sectorType: CorporationType;
    capitalStock?: number | null;
    capacityBookAnchor?: number | null;
  } | null;
  unitsTaken: number;
  unitsReceived: number;
  year: number;
  eraUnitScale: number;
}): { defenderSet: { capacityBookAnchor?: number }; attackerBookAnchor: number } {
  const { defender, attacker, unitsTaken, unitsReceived, year, eraUnitScale } = args;
  const defenderStock =
    typeof defender.capitalStock === "number" && Number.isFinite(defender.capitalStock)
      ? Math.max(0, defender.capitalStock)
      : 0;
  const transfer = capacityCaptureBookTransfer({
    // The defender's fallback is its list value, and that is the honest basis
    // for capacity that predates the build path — so price the transfer off it
    // when no basis is recorded, rather than moving nothing.
    sourceBookAnchor:
      typeof defender.capacityBookAnchor === "number" &&
      Number.isFinite(defender.capacityBookAnchor) &&
      defender.capacityBookAnchor >= 0
        ? defender.capacityBookAnchor
        : defenderStock * capacityPricePerUnit(defender.sectorType, year, eraUnitScale),
    sourceStock: defenderStock,
    unitsTaken,
    unitsReceived,
  });
  const hasDefenderBasis =
    typeof defender.capacityBookAnchor === "number" &&
    Number.isFinite(defender.capacityBookAnchor) &&
    defender.capacityBookAnchor >= 0;
  const attackerStock =
    attacker && typeof attacker.capitalStock === "number" && Number.isFinite(attacker.capitalStock)
      ? Math.max(0, attacker.capitalStock)
      : 0;
  const attackerPrior =
    attacker &&
    typeof attacker.capacityBookAnchor === "number" &&
    Number.isFinite(attacker.capacityBookAnchor) &&
    attacker.capacityBookAnchor >= 0
      ? attacker.capacityBookAnchor
      : attackerStock *
        capacityPricePerUnit(attacker?.sectorType ?? defender.sectorType, year, eraUnitScale);
  return {
    defenderSet:
      hasDefenderBasis && transfer
        ? {
            capacityBookAnchor: Math.max(
              0,
              (defender.capacityBookAnchor as number) - transfer.bookRemovedFromSource
            ),
          }
        : {},
    attackerBookAnchor: Math.max(0, attackerPrior + (transfer?.bookToAttacker ?? 0)),
  };
}

export interface CapacityCaptureResult {
  /** Capacity units removed from the defender (or from the unowned pool). */
  unitsTaken: number;
  /** Capacity units that actually reach the attacker (attrition applied). */
  unitsReceived: number;
}

/**
 * Convert an ₳ capture into the capacity units it represents at `strategyId`'s
 * output mix, and split it into taken vs received.
 *
 * `computeSectorImpliedUnits` is the same revenue -> units conversion the
 * engine's `impliedOutputUnits` and the unowned headroom derivation use, so the
 * units produced here are commensurable with `capitalStock` and with
 * `unownedSectors.headroomUnits`.
 */
export function capacityCaptureUnits(
  capturedAnchor: number,
  sectorType: CorporationType,
  strategyId: string | null | undefined,
  unitScale: number
): CapacityCaptureResult {
  const unitsTaken =
    Number.isFinite(capturedAnchor) && capturedAnchor > 0
      ? computeSectorImpliedUnits(sectorType, capturedAnchor, strategyId, unitScale)
      : 0;
  return {
    unitsTaken,
    unitsReceived: unitsTaken * ATTACK_CAPTURE_EFFICIENCY,
  };
}

/**
 * The plants attack price: never below the legacy cost, never below the build
 * price of the capacity actually received (times the premium).
 *
 * Only the era-indexed base build price is used, not the situational
 * multipliers `computeBuildCost` applies (dominance, prime rate, acumen, tech,
 * host cost of living). Those describe the difficulty of COMMISSIONING a plant
 * where you are standing; none of them describe seizing one that already
 * exists, and several of them (acumen, tech) would hand the strongest attackers
 * a discount on the very lever meant to keep attacking expensive. The premium
 * is set above 1 with those multipliers assumed neutral, and the floor is a
 * `max`, so a build cheapened by acumen/tech can dip under the attack price —
 * which is the intended ordering.
 */
export function attackCostAnchorUnderPlants(args: {
  legacyCostAnchor: number;
  unitsReceived: number;
  sectorType: CorporationType;
  year: number;
  eraUnitScale: number;
}): number {
  const { legacyCostAnchor, unitsReceived, sectorType, year, eraUnitScale } = args;
  const legacy = Number.isFinite(legacyCostAnchor) ? Math.max(0, legacyCostAnchor) : 0;
  if (!(Number.isFinite(unitsReceived) && unitsReceived > 0)) return legacy;
  const capacityFloor =
    unitsReceived *
    capacityPricePerUnit(sectorType, year, eraUnitScale) *
    ATTACK_BUILD_PRICE_PREMIUM;
  return Math.round(Math.max(legacy, capacityFloor));
}
