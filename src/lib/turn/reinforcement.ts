import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getNationalManpower, setNationalManpower } from "@/lib/db/collections/nationalManpower";
import { reinforceUnit, manpowerCeiling } from "@/lib/military/manpower";
import { resolveConscriptionStanceFor } from "@/lib/military/conscriptionLaw";
import { ATTRITION } from "@/lib/military/config";

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
  countryId: string
): Promise<{ regenerated: number; reinforced: number; drawn: number }> {
  const stance = await resolveConscriptionStanceFor(db, countryId);
  const { pool, mode } = await getNationalManpower(db, countryId);

  // Pool regeneration, capped, scaled by the conscription stance.
  const states = await db
    .collection<{ population?: number }>("states")
    .find({ countryId: countryId as CountryId })
    .toArray();
  const population = states.reduce((a, s) => a + (s.population ?? 0), 0);
  const cap = manpowerCeiling(population, stance.poolMult);
  const regen = Math.floor(population * ATTRITION.manpowerRegenFraction * stance.poolMult);
  let available = Math.min(cap, pool + regen);
  const regenerated = Math.max(0, available - pool);

  if (mode === "off") {
    if (regenerated > 0) await setNationalManpower(db, countryId, { pool: available });
    return { regenerated, reinforced: 0, drawn: 0 };
  }
  // A nation whose stance forbids conscription reinforces with trained men instead.
  const effectiveMode = mode === "conscript" && !stance.conscriptAllowed ? "trained" : mode;

  const unitsCol = getMilitaryUnitsCollection(db);
  const units = await unitsCol.find({ countryId: countryId as CountryId }).toArray();
  const ops = [];
  let drawn = 0;
  for (const u of units) {
    if (available <= 0) break;
    const r = reinforceUnit(u, effectiveMode, available);
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
  if (ops.length) await unitsCol.bulkWrite(ops);
  await setNationalManpower(db, countryId, { pool: available });
  return { regenerated, reinforced: ops.length, drawn };
}
