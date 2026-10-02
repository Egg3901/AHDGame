import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getNationalManpower, setNationalManpower } from "@/lib/db/collections/nationalManpower";
import { reinforceUnit, manpowerCeiling } from "@/lib/military/manpower";
import { resolveConscriptionStanceFor } from "@/lib/military/conscriptionLaw";
import { ATTRITION } from "@/lib/military/config";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { allocateReinforcements } from "@/lib/military/rules/reinforcementAllocation";

/**
 * Per-turn replacement flow: regenerate the nation's manpower pool from its population
 * and conscription stance, then top up under-strength units and decrement the pool.
 *
 * Runs for EVERY country, including those with no defense seat — simulated nations must
 * sustain their forces too. That is why this is not folded into applyMilitaryForceEffects,
 * whose first act is to return early when there is no defense position.
 */
export async function applyReinforcement(
  db: Db,
  countryId: string,
  knownUnits?: MilitaryUnit[]
): Promise<{ regenerated: number; reinforced: number; drawn: number }> {
  const stance = await resolveConscriptionStanceFor(db, countryId);

  // Population and the optional tick-wide unit snapshot are stable inputs. The live
  // manpower row is read inside the transaction below so another writer cannot slip
  // between replacement planning and the debit that pays for it.
  const states = await db
    .collection<{ population?: number }>("states")
    .find({ countryId: countryId as CountryId })
    .toArray();
  const population = states.reduce((a, s) => a + (s.population ?? 0), 0);
  const cap = manpowerCeiling(population, stance.poolMult);
  const regen = Math.floor(population * ATTRITION.manpowerRegenFraction * stance.poolMult);

  const apply = async (session?: ClientSession) => {
    const { pool, mode } = await getNationalManpower(db, countryId, session);
    let available = Math.min(cap, pool + regen);
    const regenerated = Math.max(0, available - pool);

    if (mode === "off") {
      if (regenerated > 0) {
        await setNationalManpower(db, countryId, { pool: available }, session);
      }
      return { regenerated, reinforced: 0, drawn: 0 };
    }

    // A nation whose stance forbids conscription reinforces with trained men instead.
    const effectiveMode = mode === "conscript" && !stance.conscriptAllowed ? "trained" : mode;
    const unitsCol = getMilitaryUnitsCollection(db);
    const units =
      knownUnits ??
      (await unitsCol
        .find({ countryId: countryId as CountryId }, { session })
        .sort({ _id: 1 })
        .toArray());
    const demands = units.map((unit) => ({
      id: String(unit._id),
      desired: reinforceUnit(unit, effectiveMode, Number.MAX_SAFE_INTEGER).drawn,
    }));
    const allocation = allocateReinforcements(demands, available);
    const ops = [];
    let drawn = 0;
    for (const u of units) {
      const r = reinforceUnit(u, effectiveMode, allocation.get(String(u._id)) ?? 0);
      if (r.drawn === 0) continue;
      available -= r.drawn;
      drawn += r.drawn;
      ops.push({
        updateOne: {
          filter: { _id: u._id },
          update: { $set: { personnel: r.personnel, vet: r.vet, xp: r.xp } },
        },
      });
    }
    if (ops.length) await unitsCol.bulkWrite(ops, session ? { session } : undefined);
    await setNationalManpower(db, countryId, { pool: available }, session);
    return { regenerated, reinforced: ops.length, drawn };
  };
  return runWithOptionalTransaction(
    (session) => apply(session),
    () => apply()
  );
}
