import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { CountryId } from "@/lib/constants/countries";
import {
  getStateResourceCapacity,
  resolveStateResourceEntry,
} from "@/lib/seeds/reference/stateResourceCapacity";

/**
 * Seed the `stateResourceCapacity` collection.
 *
 * Strategy: every state gets a capacity doc. States listed in the capacity map
 * get their specific ceilings; every other state gets `resources: {}` which
 * caps extraction of every resource to 0. This prevents the
 * extraction-capacity multiplier from defaulting to 1.0 for unlisted states,
 * which would inflate supply and skew commodity margins.
 *
 * Must run AFTER the `states` collection is seeded — it reads state IDs from
 * that collection to ensure full coverage.
 *
 * `preset` is used to zero out resources that didn't yet exist in the era
 * (e.g. Nigeria oil pre-1958, UK North Sea pre-1969).
 */
export async function seedStateResourceCapacity(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db
      .collection("stateResourceCapacity")
      .drop()
      .catch(() => {});
  }

  const states = await db
    .collection<{ _id: string; countryId: CountryId }>("states")
    .find({}, { projection: { _id: 1, countryId: 1 } })
    .toArray();

  if (states.length === 0) {
    log("seedStateResourceCapacity: no states found — run states seed first");
    return;
  }

  const now = new Date();
  let withResources = 0;
  let emptyDefault = 0;

  const capacityMap = getStateResourceCapacity(preset);
  const ops: AnyBulkWriteOperation<StateResourceCapacity>[] = [];

  // Indexes before the upserts, not after: the writes below filter on
  // `stateId`, and building the index afterwards makes each one a collection
  // scan. Round-trip latency used to hide that; the batched write does not.
  await db
    .collection("stateResourceCapacity")
    .createIndex({ stateId: 1 }, { unique: true })
    .catch(() => {});
  await db
    .collection("stateResourceCapacity")
    .createIndex({ countryId: 1 })
    .catch(() => {});

  for (const state of states) {
    // capacityMap is keyed by `${countryId}:${stateId}` so cross-country
    // state-ID collisions (e.g. CN HB / DE HB) can't accidentally route a
    // state to the wrong country's resource budget. `resolveStateResourceEntry`
    // keeps that guarantee while surviving a country merge: a state absorbed
    // into another country now reads under the SURVIVOR's id, and a bare
    // compound lookup would miss and WIPE its deposits to `{}` on the next
    // re-seed (ticket #1271).
    const entry = resolveStateResourceEntry(capacityMap, state.countryId, state._id, (candidates) =>
      log(
        `seedStateResourceCapacity: ambiguous capacity for ${state._id} ` +
          `(defined by ${candidates.join(", ")}), seeding empty`
      )
    );
    const resources = entry?.resources ?? {};
    // The STATE row owns the country, not the capacity entry: after a merge the
    // entry still carries the absorbed country's id and copying it back would
    // undo the re-key `mergeCountry` just performed. Identical for every
    // unmerged world, where the two always agree.
    const countryId: CountryId = state.countryId;

    ops.push({
      updateOne: {
        filter: { stateId: state._id },
        update: {
          $set: {
            stateId: state._id,
            countryId,
            resources,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    });

    if (Object.keys(resources).length > 0) withResources++;
    else emptyDefault++;
  }

  if (ops.length > 0) {
    await db
      .collection<StateResourceCapacity>("stateResourceCapacity")
      .bulkWrite(ops, { ordered: true });
  }

  log(
    `Seeded ${withResources + emptyDefault} stateResourceCapacity docs ` +
      `(${withResources} with capacity, ${emptyDefault} empty default)`
  );
}
