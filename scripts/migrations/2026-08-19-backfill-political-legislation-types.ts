import type { Db } from "mongodb";
import type { MigrationResult } from "../../src/lib/migrations/types";
import type { LegislationType } from "@/lib/db/types/legislation";
import { getEraContext } from "@/lib/era/context";
import {
  getProjectedPoliticalLegislationTypes,
  isPoliticalLegislationPreset,
} from "@/lib/admin/seed/seedPoliticalLegislation";

/**
 * Ticket #1106 - backfill new-generation legislation types into a LIVE world.
 *
 * `legislationTypes` docs are written only by the world seeder
 * (seedLegislationTypes / bootstrapGameWorld), which never re-runs on a live
 * world. So any law added to the typed catalog after a world was seeded exists
 * in code but has no proposable doc in Mongo. That is why the US state tax
 * sliders shipped in the catalog and the Tax category still rendered with
 * nothing selectable for governors and state legislatures: the picker calls
 * `GET /api/game/legislation-types?category=tax&scope=state&country=us`, which
 * reads Mongo, and Mongo only had the six `allowedScope: "national"` federal
 * tax laws.
 *
 * Inserts MISSING projected types only. Existing docs are left untouched so a
 * live world keeps admin law-type edits and any drifted state.
 */
export async function runBackfillPoliticalLegislationTypes(
  db: Db,
  opts: { dryRun?: boolean } = {}
): Promise<MigrationResult> {
  const notes: string[] = [];
  const { preset, year } = await getEraContext(db);

  if (preset != null && !isPoliticalLegislationPreset(preset)) {
    return { notes: [`Preset ${preset} is not a political-legislation preset; nothing to do.`] };
  }

  // Null year (era system off) projects the whole catalog, matching what the
  // seeder does for a legacy world.
  const projected = getProjectedPoliticalLegislationTypes(year ?? undefined);
  const collection = db.collection<LegislationType>("legislationTypes");
  const existing = await collection
    .find({ _id: { $in: projected.map((t) => t._id) } }, { projection: { _id: 1 } })
    .toArray();
  const existingIds = new Set(existing.map((d) => String(d._id)));
  const missing = projected.filter((t) => !existingIds.has(String(t._id)));

  notes.push(`World year ${year ?? "none"}; ${projected.length} projected types.`);
  if (missing.length === 0) {
    notes.push("No missing legislation types.");
    return { documentsScanned: projected.length, documentsInserted: 0, notes };
  }

  notes.push(`Missing: ${missing.map((t) => t._id).join(", ")}`);
  if (opts.dryRun) {
    notes.push("Dry run: no writes performed.");
    return { documentsScanned: projected.length, documentsInserted: 0, notes };
  }

  await collection.bulkWrite(
    missing.map((t) => ({
      updateOne: { filter: { _id: t._id }, update: { $setOnInsert: t }, upsert: true },
    }))
  );

  return {
    documentsScanned: projected.length,
    documentsInserted: missing.length,
    notes,
  };
}
