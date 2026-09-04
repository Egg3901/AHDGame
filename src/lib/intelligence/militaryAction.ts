import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getConflictsCollection, listActiveConflicts } from "@/lib/db/collections/conflicts";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { belligerentSideOf } from "@/lib/military/conflictVisibility";
import { SABOTAGE_READINESS_POINTS, SABOTAGE_SUPPLY_POINTS, SABOTAGE_UNIT_COUNT } from "./config";

/**
 * Supply sabotage moves the SEEDED BASE, not the live reading.
 *
 * `occupation.derivedSupplies` computes `supplyA`/`supplyB` from
 * `supplyBaseA`/`supplyBaseB` plus how far the front has moved, and
 * `conflict.ts` says so outright: "preserved so live supply can be derived, not
 * accumulated". Writing the derived value would be recomputed away on the very
 * next pass, exactly as writing a navair channel would be. The base is the only
 * durable handle on a front's supply.
 */
export function sabotagedSupplyBase(base: number): number {
  if (!Number.isFinite(base)) return 0;
  return Math.max(0, Math.min(100, base - SABOTAGE_SUPPLY_POINTS));
}

/** Readiness is genuinely stored per formation, so it can be written directly. */
export function degradedReadiness(readiness: number): number {
  if (!Number.isFinite(readiness)) return 0;
  return Math.max(0, Math.min(100, readiness - SABOTAGE_READINESS_POINTS));
}

export interface MilitaryActionResult {
  frontSabotaged: string | null;
  formationsDegraded: number;
}

const NOTHING: MilitaryActionResult = { frontSabotaged: null, formationsDegraded: 0 };

/**
 * The effect half of a successful military covert action.
 *
 * Two durable handles, chosen because they are the only two that survive a turn:
 *
 * - the front's SEEDED supply base, for the reason above;
 * - per-formation `readiness`, which is stored state.
 *
 * Sea control and air superiority are deliberately NOT touched: `processNavairTurn`
 * recomputes both from live units every pass, so anything written to them is
 * erased in the same turn it was written. A sabotage that silently does nothing
 * is worse than no sabotage at all.
 *
 * One front per operation. Hitting every war a country is in at once would make
 * a single operation decisive against a nation fighting on several fronts, which
 * is not what one covert team can do.
 */
export async function applyMilitaryAction(
  db: Db,
  targetCountryId: CountryId
): Promise<MilitaryActionResult> {
  const conflicts = await listActiveConflicts(db);
  const front = conflicts.find((c) => belligerentSideOf(c, targetCountryId) !== null);

  let frontSabotaged: string | null = null;
  if (front) {
    const side = belligerentSideOf(front, targetCountryId);
    // Fall back to the live reading only when a conflict predates the bases,
    // which is what `derivedSupplies` itself does.
    const currentBase =
      side === "A" ? (front.supplyBaseA ?? front.supplyA) : (front.supplyBaseB ?? front.supplyB);
    const field = side === "A" ? "supplyBaseA" : "supplyBaseB";
    await getConflictsCollection(db).updateOne(
      { _id: front._id },
      { $set: { [field]: sabotagedSupplyBase(currentBase) } }
    );
    frontSabotaged = String(front._id);
  }

  const units = await getMilitaryUnitsCollection(db)
    .find({ countryId: targetCountryId })
    .sort({ readiness: -1 })
    .limit(SABOTAGE_UNIT_COUNT)
    .toArray();

  for (const unit of units) {
    await getMilitaryUnitsCollection(db).updateOne(
      { _id: unit._id },
      { $set: { readiness: degradedReadiness(unit.readiness) } }
    );
  }

  return frontSabotaged === null && units.length === 0
    ? NOTHING
    : { frontSabotaged, formationsDegraded: units.length };
}
