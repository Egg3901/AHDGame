import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getUnitArchetype } from "@/lib/constants/military";
import { getNationalArsenal, drawLots, returnLots } from "@/lib/db/collections/nationalArsenal";
import {
  applyEquipmentLots,
  lotsRequired,
  lotsToFillUnit,
  refitOrder,
} from "@/lib/military/arsenal";

export interface RefitResult {
  unitsRefitted: number;
  lotsUsed: number;
}

/**
 * Per-turn: bring under-equipped units up to standard from the national arsenal.
 *
 * This is the step that makes the design's central promise true — a unit raised against an
 * empty store "starts at a lower quality and builds up over time" — and it is the first thing
 * in the game's history that RAISES `equipment`. Combat has read that field on every
 * calculation since it was written (`computeEffectivePower` folds `1 + eqAvg × 0.03`), but it
 * was only ever set at seed and at recruit and nothing could move it.
 *
 * Refits nearest-to-complete first. With scarce stock that produces some combat-worthy
 * formations rather than raising every unit a little and leaving none of them effective — the
 * same reasoning `reinforceUnit` uses when manpower is short.
 *
 * Runs for EVERY country with units, defence seat or not, following `applyReinforcement`
 * rather than `applyMilitaryForceEffects`: a nation whose army is fed manpower and materiel
 * but exempt from one of them would be a standing asymmetry.
 *
 * Deliberately does NOT raise `techTier`. Tier is the grade of the materiel a unit was ISSUED
 * with; topping up a legacy formation's racks does not turn it into a modern one. Upgrading a
 * unit's tier remains the paid modernisation route.
 */
export async function applyDefenceRefit(db: Db, countryId: string): Promise<RefitResult> {
  const unitsCol = getMilitaryUnitsCollection(db);
  const units = await unitsCol.find({ countryId: countryId as CountryId }).toArray();
  if (units.length === 0) return { unitsRefitted: 0, lotsUsed: 0 };

  const arsenal = await getNationalArsenal(db, countryId);
  // Nothing in store anywhere — skip before touching a single unit.
  if (!Object.values(arsenal.stock).some((v) => v > 0)) {
    return { unitsRefitted: 0, lotsUsed: 0 };
  }

  const ops: AnyBulkWriteOperation<MilitaryUnit>[] = [];
  let lotsUsed = 0;
  /** Lots taken per domain this turn, so a failed write can put them back. */
  const drawnByDomain = new Map<string, number>();

  // Grouped by domain because each domain draws from its own store: a full armoury does not
  // help a starved navy, which is the whole point of a per-domain arsenal.
  const byDomain = new Map<string, MilitaryUnit[]>();
  for (const u of units) {
    if (!byDomain.has(u.domain)) byDomain.set(u.domain, []);
    byDomain.get(u.domain)!.push(u);
  }

  for (const [domain, domainUnits] of byDomain) {
    if ((arsenal.stock[domain as keyof typeof arsenal.stock] ?? 0) <= 0) continue;

    for (const unit of refitOrder(domainUnits)) {
      const archetype = getUnitArchetype(unit.domain, unit.type);
      // An unrecognised archetype has no known materiel requirement; leave it alone rather
      // than guessing one.
      if (!archetype) continue;

      const needed = lotsToFillUnit(unit, lotsRequired(archetype));
      if (needed <= 0) continue;

      const drawn = await drawLots(db, countryId, unit.domain, needed);
      if (drawn <= 0) break; // this domain's store is exhausted

      const fullLots = lotsRequired(archetype);
      // Preserve the sub-track value of every lot and redirect it toward tracks that still
      // need equipment. Rounding each track here used to consume small deliveries without
      // changing the unit at all.
      const equipment = applyEquipmentLots(unit.equipment, drawn, fullLots);

      ops.push({
        updateOne: {
          filter: { _id: unit._id },
          update: {
            $set: {
              equipment,
            },
          },
        },
      });
      lotsUsed += drawn;
      drawnByDomain.set(unit.domain, (drawnByDomain.get(unit.domain) ?? 0) + drawn);
    }
  }

  if (ops.length > 0) {
    try {
      await unitsCol.bulkWrite(ops);
    } catch (error) {
      // Lots are drawn per unit but written in one batch, so a failed write would otherwise
      // destroy every lot taken this turn with nothing issued for them. Put them back before
      // rethrowing — materiel a nation paid for must not evaporate because a write failed.
      for (const [domain, lots] of drawnByDomain) {
        await returnLots(db, countryId, domain as MilitaryUnit["domain"], lots);
      }
      throw error;
    }
  }
  return { unitsRefitted: ops.length, lotsUsed };
}
