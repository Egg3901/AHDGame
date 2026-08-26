import type { Db } from "mongodb";
import type { MigrationResult } from "../../src/lib/migrations/types";
import type { LegislationType } from "@/lib/db/types/legislation";
import { legislationTypes as referenceTypes } from "@/lib/seeds/reference/legislationTypes";
import { OLD_CATALOG_EXEMPT_TYPE_IDS } from "@/lib/politicalMetrics/pipelinePreset";

/**
 * Ticket #1189 - backfill the mechanical redistricting laws into a LIVE world.
 *
 * The three US state redistricting laws (`us_state_redistricting_authority`,
 * `us_state_compactness`, `us_state_fairness`) are old-catalog US types, so
 * the political-legislation exclusion sweep stopped seeding them and reseed
 * pruning deleted them from every live world. The districted-House engine still
 * reads them (`src/lib/redistricting/caps.ts`, census auto-neutralize), so with
 * no doc players had no bill option to change redistricting authority at all.
 *
 * The seeder gate fix keeps them seeded going forward; this migration repairs
 * already-running worlds. Inserts MISSING types only via $setOnInsert, so admin
 * law-type edits and any drifted doc are left untouched.
 */
export async function runBackfillRedistrictingLawTypes(
  db: Db,
  opts: { dryRun?: boolean } = {}
): Promise<MigrationResult> {
  const notes: string[] = [];
  const wanted = referenceTypes.filter((t) => OLD_CATALOG_EXEMPT_TYPE_IDS.has(t._id));

  const collection = db.collection<LegislationType>("legislationTypes");
  const existing = await collection
    .find({ _id: { $in: wanted.map((t) => t._id) } }, { projection: { _id: 1 } })
    .toArray();
  const existingIds = new Set(existing.map((d) => String(d._id)));
  const missing = wanted.filter((t) => !existingIds.has(String(t._id)));

  notes.push(`${wanted.length} redistricting law types in the reference catalog.`);
  if (missing.length === 0) {
    notes.push("No missing legislation types.");
    return { documentsScanned: wanted.length, documentsInserted: 0, notes };
  }

  notes.push(`Missing: ${missing.map((t) => t._id).join(", ")}`);
  if (opts.dryRun) {
    notes.push("Dry run: no writes performed.");
    return { documentsScanned: wanted.length, documentsInserted: 0, notes };
  }

  await collection.bulkWrite(
    missing.map((t) => ({
      updateOne: { filter: { _id: t._id }, update: { $setOnInsert: t }, upsert: true },
    }))
  );

  return {
    documentsScanned: wanted.length,
    documentsInserted: missing.length,
    notes,
  };
}
