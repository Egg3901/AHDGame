import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getNationalManpowerCollection } from "@/lib/db/collections/nationalManpower";
import { resolveConscriptionStanceFor } from "@/lib/military/conscriptionLaw";
import { initialManpowerPool } from "@/lib/military/manpower";

/**
 * Seed every nation's replacement-manpower pool.
 *
 * Without this the collection starts empty and two paths race to create the
 * document with values four apart: the turn loop (`applyReinforcement`) reads a
 * missing doc as `pool: 0` and lands on one turn's regeneration, while
 * procurement (`ensureManpowerPool`) heals to the full ceiling. Turns tick
 * hourly, so the turn loop wins and every nation effectively started at
 * `population × 0.0005` — too little for a small country to raise even one
 * formation (DD fielded 8,200 against a 12,000-man division).
 *
 * Covers ALL countries, not just those with a defense seat or an era-active
 * branch: `applyReinforcement` already iterates every country each turn on the
 * same reasoning (simulated nations sustain their forces too), so one rule with
 * no exceptions is the honest shape.
 *
 * Idempotent TWICE OVER, and both matter:
 *
 * 1. Skips any country that already has a document, so re-running can never
 *    refill a nation that has spent its manpower.
 * 2. Skips any country with **zero population** rather than writing `pool: 0`.
 *    This is what makes the seeder safe to call more than once per world.
 *    `runCoreSeed` seeds only US states — every other country's regions come
 *    from per-country seeders that run later (the same ordering hazard
 *    `seedStateResourceCapacity` and `seedPoliticalMetrics` are re-run for), so
 *    an early pass sees 27 countries with no population. Writing a zero document
 *    there would poison rule 1: the later pass would skip them as "already
 *    seeded" and every non-US nation would start at 0 forever.
 *
 * Call it after the states seed and again once every region seeder has run. A
 * country that genuinely has no regions gets no document, and the
 * `ensureManpowerPool` heal covers it on demand.
 */
export async function seedNationalManpower(
  db: Db,
  log: (message: string) => void = () => {}
): Promise<{ seeded: number; skipped: number; deferred: number }> {
  const col = getNationalManpowerCollection(db);
  const existing = await col.distinct("countryId");
  const already = new Set(existing.map(String));

  // One grouped read instead of a states scan per country.
  const populations = new Map<string, number>(
    (
      await db
        .collection<{ countryId?: string; population?: number }>("states")
        .aggregate<{ _id: string; population: number }>([
          { $group: { _id: "$countryId", population: { $sum: "$population" } } },
        ])
        .toArray()
    ).map((row) => [String(row._id), row.population ?? 0])
  );

  let seeded = 0;
  let skipped = 0;
  let deferred = 0;
  for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
    if (already.has(countryId)) {
      skipped++;
      continue;
    }
    const population = populations.get(countryId) ?? 0;
    if (population <= 0) {
      // Its regions do not exist YET (or at all). Leave no document so a later
      // pass can still seed it — see rule 2 above.
      deferred++;
      continue;
    }
    const stance = await resolveConscriptionStanceFor(db, countryId);
    const pool = initialManpowerPool(population, stance.poolMult);
    // `mode` is written explicitly: NationalManpower requires it, and a document
    // created with only `{ countryId, pool }` violates its own type — after which
    // `applyReinforcement` reads `mode: undefined`, skips its "off" branch and
    // lands on trained-rate behaviour by accident rather than by decision.
    await col.updateOne(
      { countryId },
      { $setOnInsert: { countryId, pool, mode: "trained" } },
      { upsert: true }
    );
    seeded++;
  }

  log(
    `Seeded nationalManpower: seeded=${seeded}, skipped=${skipped}, ` +
      `deferred=${deferred} (no regions yet)`
  );
  return { seeded, skipped, deferred };
}
