/**
 * Migration: retire the 4 static proxy theaters (dynamic-conflict model, sub-project A).
 *
 * The hardcoded THEATERS/FRONTS (afghan, nicaragua, angola, ogaden) are gone —
 * conflicts are now dynamic documents in the `conflicts` collection and the world
 * starts empty. Any live state keyed to the retired theater ids is stale and must be
 * cleared so nothing references a theater that no longer exists:
 *
 *   - militaryUnits: a unit sitting at a retired theater returns home → theaterId "reserve".
 *   - militaryFormations: conflictAssignments pointed generals at retired theaters → [].
 *   - battleDeclarations / battleReports / theaterState: all keyed to retired theaters,
 *     and conflicts start empty, so these are dropped wholesale.
 *
 * Idempotent: re-running finds nothing to reset (units already at reserve, no
 * assignments, empty battle collections) and reports zero changes.
 *
 * Usage: npx tsx scripts/migrations/2026-07-23-retire-static-theaters.ts [--dry-run]
 */
import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";

export interface RetireTheatersResult {
  unitsReset: number;
  formationsCleared: number;
  declarationsDropped: number;
  reportsDropped: number;
  theaterStatesDropped: number;
}

/** What the migration would change, without writing. */
export async function previewRetireStaticTheaters(db: Db): Promise<RetireTheatersResult> {
  return {
    unitsReset: await db
      .collection("militaryUnits")
      .countDocuments({ theaterId: { $ne: "reserve" } }),
    formationsCleared: await db
      .collection("militaryFormations")
      .countDocuments({ "conflictAssignments.0": { $exists: true } }),
    declarationsDropped: await db.collection("battleDeclarations").countDocuments({}),
    reportsDropped: await db.collection("battleReports").countDocuments({}),
    theaterStatesDropped: await db.collection("theaterState").countDocuments({}),
  };
}

/**
 * Pure migration logic. Exported so the test suite can drive it against a MockDb
 * without parsing CLI args or touching env vars.
 */
export async function applyRetireStaticTheaters(db: Db): Promise<RetireTheatersResult> {
  const counts = await previewRetireStaticTheaters(db);

  if (counts.unitsReset > 0) {
    await db
      .collection("militaryUnits")
      .updateMany({ theaterId: { $ne: "reserve" } }, { $set: { theaterId: "reserve" } });
  }
  if (counts.formationsCleared > 0) {
    await db
      .collection("militaryFormations")
      .updateMany(
        { "conflictAssignments.0": { $exists: true } },
        { $set: { conflictAssignments: [] } }
      );
  }
  if (counts.declarationsDropped > 0) await db.collection("battleDeclarations").deleteMany({});
  if (counts.reportsDropped > 0) await db.collection("battleReports").deleteMany({});
  if (counts.theaterStatesDropped > 0) await db.collection("theaterState").deleteMany({});

  return counts;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();

  if (dryRun) {
    const c = await previewRetireStaticTheaters(db);
    console.log(
      `[DRY RUN] would reset ${c.unitsReset} units to reserve, clear ` +
        `${c.formationsCleared} formations' assignments, and drop ` +
        `${c.declarationsDropped} declarations / ${c.reportsDropped} reports / ` +
        `${c.theaterStatesDropped} theater states.`
    );
    await closeDb();
    return;
  }

  const r = await applyRetireStaticTheaters(db);
  console.log(
    `Done. unitsReset=${r.unitsReset}, formationsCleared=${r.formationsCleared}, ` +
      `declarationsDropped=${r.declarationsDropped}, reportsDropped=${r.reportsDropped}, ` +
      `theaterStatesDropped=${r.theaterStatesDropped}`
  );
  await closeDb();
}

// Only run main when invoked directly via `npx tsx ...`; the test suite imports
// `applyRetireStaticTheaters` without triggering this block.
if (require.main === module) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
