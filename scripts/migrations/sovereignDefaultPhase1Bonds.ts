/**
 * Phase 1 migration (sovereign default subsystem): backfill new audit fields
 * on `bonds` collection. Adds:
 *   - restructureHaircutPercent = null
 *   - restructureExtendedMaturityTurn = null
 *   - originalMaturityTurn = null
 *   - originalTotalIssued = null
 *
 * **Additive only** — does not modify existing bond fields.
 *
 * Idempotent via `migrationsRun` marker (_id = "sovereign-default-phase1-bonds").
 *
 * CRASH RECOVERY: writes gated on `restructureHaircutPercent: { $exists: false }`.
 *
 * Usage: `MONGODB_URI=... npx tsx scripts/migrations/sovereignDefaultPhase1Bonds.ts`
 *        Add `--dry-run` to preview without writing.
 */

import { connectDb, closeDb } from "../utils/db";
import type { Bond } from "../../src/lib/db/types/bond";

const MARKER_ID = "sovereign-default-phase1-bonds";

interface MigrationMarker {
  _id: string;
  completedAt: Date;
  documentsUpdated: number;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();
  try {
    const marker = await db
      .collection<MigrationMarker>("migrationsRun")
      .findOne({ _id: MARKER_ID });
    if (marker) {
      console.log(`[${MARKER_ID}] already ran at ${marker.completedAt}. Exiting.`);
      return;
    }

    const gameState = await db
      .collection<{ _id: string; isActive?: boolean; isProcessing?: boolean }>("gameState")
      .findOne({ _id: "current" });
    if (gameState?.isActive || gameState?.isProcessing) {
      console.warn(`[${MARKER_ID}] WARNING: gameState may be live. Continuing in 5 seconds.`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    const collection = db.collection<Bond>("bonds");
    const candidateCount = await collection.countDocuments({
      restructureHaircutPercent: { $exists: false },
    });

    console.log(`[${MARKER_ID}] Found ${candidateCount} bonds needing migration.`);

    if (dryRun) {
      console.log(`[${MARKER_ID}] DRY RUN — no writes performed.`);
      return;
    }

    const result = await collection.updateMany(
      { restructureHaircutPercent: { $exists: false } },
      {
        $set: {
          restructureHaircutPercent: null,
          restructureExtendedMaturityTurn: null,
          originalMaturityTurn: null,
          originalTotalIssued: null,
        },
      }
    );

    console.log(`[${MARKER_ID}] Updated ${result.modifiedCount} bonds.`);

    await db.collection<MigrationMarker>("migrationsRun").insertOne({
      _id: MARKER_ID,
      completedAt: new Date(),
      documentsUpdated: result.modifiedCount,
    });
    console.log(`[${MARKER_ID}] Marker written. Migration complete.`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(`[${MARKER_ID}] FAILED:`, err);
  process.exit(1);
});
