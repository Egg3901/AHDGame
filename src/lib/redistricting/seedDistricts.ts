import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CongressionalDistrict } from "@/lib/db/types";
import { buildDistrictDocsForStates } from "./buildStateDocs";
import { seedRedistrictingAuthority } from "./seedRedistrictingAuthority";

interface SeedOpts {
  countryId?: CountryId;
  now: Date;
  log?: (m: string) => void;
}

/**
 * Seed `congressionalDistricts` for every state of `countryId` (default "US").
 * Idempotent — upserts by `_id`. The shared per-state builder does the reads +
 * pure math; this only persists.
 */
export async function seedCongressionalDistricts(
  db: Db,
  opts: SeedOpts
): Promise<{ seeded: number }> {
  const countryId = (opts.countryId ?? "US") as CountryId;
  const log = opts.log ?? (() => {});

  const docs = await buildDistrictDocsForStates(db, countryId, opts.now);
  if (docs.length > 0) {
    await db.collection<CongressionalDistrict>("congressionalDistricts").bulkWrite(
      docs.map((doc) => ({
        updateOne: { filter: { _id: doc._id }, update: { $set: doc }, upsert: true },
      })),
      { ordered: true }
    );
  }
  const seeded = docs.length;

  await db
    .collection("congressionalDistricts")
    .createIndex({ countryId: 1, stateId: 1, index: 1 }, { unique: true })
    .catch(() => {});

  log(`Seeded ${seeded} congressional districts (${countryId})`);

  // Seed the authority law to legislature-drawn for every state that got
  // districts. Without this the redistricting feature is unreachable (the code
  // default is bipartisan commission, which cannot redraw) and the default is
  // historically wrong for the 1953/1960 eras.
  await seedRedistrictingAuthority(db, {
    countryId,
    stateIds: docs.map((d) => d.stateId),
    now: opts.now,
    log,
  });

  return { seeded };
}
