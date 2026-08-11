import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  getNationalManpowerCollection,
  setNationalManpower,
} from "@/lib/db/collections/nationalManpower";
import { resolveConscriptionStanceFor } from "@/lib/military/conscriptionLaw";
import { manpowerCeiling, initialManpowerPool } from "@/lib/military/manpower";

async function populationOf(db: Db, countryId: string): Promise<number> {
  const states = await db
    .collection<{ population?: number }>("states")
    .find({ countryId: countryId as CountryId })
    .toArray();
  return states.reduce((a, s) => a + (s.population ?? 0), 0);
}

/**
 * `mode` is written explicitly wherever this module upserts: NationalManpower
 * REQUIRES it, and a document created with only `{ countryId, pool }` violates
 * its own type — after which `applyReinforcement` reads `mode: undefined`, skips
 * its "off" branch and lands on trained-rate behaviour by accident rather than
 * by decision.
 */
async function ceilingFor(db: Db, countryId: string): Promise<number> {
  const stance = await resolveConscriptionStanceFor(db, countryId);
  return manpowerCeiling(await populationOf(db, countryId), stance.poolMult);
}

/**
 * The nation's pool and ceiling, healing a missing document in place.
 *
 * `getNationalManpower` returns `pool: 0` when no document exists, which would
 * leave every newly-enabled country unable to recruit until the per-turn
 * reinforcement flow first ran. Healing mirrors how `treasuryTurn` heals a null
 * `treasuryBalance`, and logs the gap.
 *
 * Heals to `initialManpowerPool` — the SAME value `seedNationalManpower` writes
 * at world creation — not to the ceiling. Both call one helper so a fresh world
 * and a healed legacy world cannot start four times apart.
 *
 * `ceiling` is null on the existing-doc path, where it is computed lazily.
 */
export async function ensureManpowerPool(
  db: Db,
  countryId: string
): Promise<{ pool: number; ceiling: number | null }> {
  const existing = await getNationalManpowerCollection(db).findOne({
    countryId: countryId as CountryId,
  });

  if (existing) {
    // `applyReinforcement` upserts `{ pool }` alone (reinforcement.ts:34), so on
    // a live world most documents already exist WITHOUT `mode`. Heal that in
    // place: a missing mode makes applyReinforcement skip its "off" branch and
    // land on trained-rate behaviour by accident rather than by decision.
    // (This spec does not merely avoid ADDING mode-less docs — it fixes them.)
    if (existing.mode == null) {
      await setNationalManpower(db, countryId, { mode: "trained" });
    }
    // Ceiling is computed lazily — the recruit path only needs `pool`, and
    // resolving it costs a legislation read plus a full states scan.
    return { pool: existing.pool, ceiling: null };
  }

  const stance = await resolveConscriptionStanceFor(db, countryId);
  const population = await populationOf(db, countryId);
  const ceiling = manpowerCeiling(population, stance.poolMult);
  const pool = initialManpowerPool(population, stance.poolMult);
  console.warn(
    `[manpowerPool] ${countryId} had no nationalManpower doc; initializing pool to ${pool} ` +
      `(25% of the ${ceiling} ceiling, matching seedNationalManpower).`
  );
  await setNationalManpower(db, countryId, { pool, mode: "trained" });
  return { pool, ceiling };
}

/** Guarded draw. False when the pool was short — caller must not proceed. */
export async function drawManpower(db: Db, countryId: string, men: number): Promise<boolean> {
  const res = await getNationalManpowerCollection(db).updateOne(
    { countryId: countryId as CountryId, pool: { $gte: men } },
    { $inc: { pool: -men } }
  );
  return res.modifiedCount > 0;
}

/**
 * Return men to the pool, never above the ceiling. Atomic in both branches — this
 * runs on the recruit rollback path, where a lost update destroys manpower.
 *
 * Branch 1 (common): guarded `$inc` when the full amount fits under the ceiling.
 * Branch 2: the increment would breach the ceiling, so clamp — but ONLY when the
 * pool is actually below it. A pool sitting ABOVE its ceiling is legitimate (a
 * conscription-stance downgrade or population fall lowers the ceiling, and
 * `applyReinforcement` only re-clamps on its own pass), and an unconditional
 * `$set: ceiling` would silently destroy that excess. `$lt: ceiling` makes the
 * clamp a no-op there, which is the safe outcome: the men stay in the pool.
 *
 * No `upsert` — `ensureManpowerPool` above guarantees the document exists, and an
 * upsert here would insert one without the required `mode`.
 */
export async function returnManpower(db: Db, countryId: string, men: number): Promise<void> {
  if (men <= 0) return;
  const { ceiling: known } = await ensureManpowerPool(db, countryId);
  // ensureManpowerPool only computes the ceiling when it had to create the doc;
  // the return path genuinely needs it, so resolve it here when it did not.
  const ceiling = known ?? (await ceilingFor(db, countryId));
  const col = getNationalManpowerCollection(db);

  const incremented = await col.updateOne(
    { countryId: countryId as CountryId, pool: { $lte: ceiling - men } },
    { $inc: { pool: men } }
  );
  if (incremented.modifiedCount > 0) return;

  await col.updateOne(
    { countryId: countryId as CountryId, pool: { $lt: ceiling } },
    { $set: { pool: ceiling } }
  );
}
