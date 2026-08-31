import type { Db } from "mongodb";
import type { LegislationType } from "@/lib/db/types";
import type { Migration, MigrationResult } from "../types";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { POLITICAL_LEGISLATION_RETAINED_OLD_IDS } from "@/lib/politicalMetrics/pipelinePreset";

/**
 * Ticket #1189 - give a live world the three state redistricting laws back.
 *
 * `legislationTypes` docs are written only by the world seeder, which never
 * re-runs on a live world. When the old US catalog was superseded by the
 * new-generation law book, the seeders began excluding it wholesale by
 * `countryScope`, and these three went with it - but nothing replaced them,
 * because a new-generation `PoliticalLaw` is a five-level program with a
 * political-metric target and these are three-option mechanical switches.
 *
 * `src/lib/redistricting/caps.ts` still reads them BY ID out of
 * `statePolicies`, so with no doc to propose against, `readOptionIndex` fell
 * to its index-1 default (bipartisan commission, `canDraw: false`) for every
 * state, permanently: no bill in any category could move it. The code fix
 * retains them at seed time; this puts them into worlds already running.
 *
 * The set comes from the same constant the seeders filter on, so the backfill
 * and a fresh seed cannot disagree about what belongs.
 *
 * Inserts MISSING ids only, via `$setOnInsert`. An existing doc is left
 * untouched so a world that already has one keeps any admin law-type edit.
 *
 * Behaviourally inert on its own: it adds a proposable bill, it does not
 * enact anything. Every state keeps the same effective authority it has now
 * (the index-1 default) until a legislature actually passes one, and the
 * census auto-neutralise sweep only looks at states sitting at index 0, of
 * which there are none.
 *
 * Scope note: the retained set is read at run time, but a migration runs once.
 * If a FOURTH id is ever retained, it needs its own migration - this one's
 * marker will already be present on every world.
 *
 * Note for operators: `GET /api/game/legislation-types` caches its reads for
 * up to five minutes, so the new laws can take that long to appear in the
 * bill picker after this runs.
 */
async function backfillRedistrictingAuthorityTypes(
  db: Db,
  dryRun: boolean
): Promise<MigrationResult> {
  const notes: string[] = [];
  const wanted = legislationTypes.filter((lt) =>
    POLITICAL_LEGISLATION_RETAINED_OLD_IDS.has(lt._id)
  );

  const collection = db.collection<LegislationType>("legislationTypes");
  const existing = await collection
    .find({ _id: { $in: wanted.map((t) => t._id) } }, { projection: { _id: 1 } })
    .toArray();
  const existingIds = new Set(existing.map((d) => String(d._id)));
  const missing = wanted.filter((t) => !existingIds.has(String(t._id)));

  notes.push(`${wanted.length} retained types; ${missing.length} missing.`);

  if (missing.length === 0) {
    notes.push("Nothing to insert.");
    return { documentsScanned: wanted.length, documentsInserted: 0, notes };
  }

  notes.push(`Inserting: ${missing.map((t) => t._id).join(", ")}`);
  if (dryRun) {
    notes.push("Dry run: no writes performed.");
    return { documentsScanned: wanted.length, documentsInserted: 0, notes };
  }

  // `_id` is deliberately kept OUT of `$setOnInsert`: the upsert filter already
  // supplies it, and naming an immutable field inside an update operator is a
  // needless way to have the server reject the write.
  await collection.bulkWrite(
    missing.map(({ _id, ...fields }) => ({
      updateOne: {
        filter: { _id },
        update: { $setOnInsert: fields as Partial<LegislationType> },
        upsert: true,
      },
    }))
  );

  return { documentsScanned: wanted.length, documentsInserted: missing.length, notes };
}

export const migration: Migration = {
  id: "2026-08-26-backfill-redistricting-authority-types",
  description:
    "Ticket #1189: insert the three state redistricting laws (authority / compactness / fairness) that stopped seeding when the old US catalog was superseded, so states can legislate who draws their map again.",
  // Inserts missing _ids only via $setOnInsert; a second pass finds nothing.
  idempotent: true,
  execute: (db, ctx) => backfillRedistrictingAuthorityTypes(db, ctx.dryRun),
};
