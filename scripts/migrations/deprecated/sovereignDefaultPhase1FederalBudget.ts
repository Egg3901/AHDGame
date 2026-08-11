/**
 * Phase 1 migration (sovereign default subsystem): zero-fill new
 * `FederalBudget` fields on existing documents.
 *
 * Adds default values for:
 *   - sovereignCrisisState = "normal"
 *   - failedAuctionConsecutiveCount = 0
 *   - lastAuctionDemandRatio = 1.0
 *   - all crisis-lifecycle fields = null
 *   - recoveryStartedAt, recoveryFiscalDisciplineStreak (0), marketAccessLockedUntilTurn, lastDefaultTurn = null/0
 *   - imfSovereignBailoutActive = false
 *   - all imfSovereign* facility fields = 0/null
 *   - all imfBoardOverride* fields = null
 *
 * **Additive only** — does not modify or remove existing fields.
 *
 * Idempotent via `migrationsRun` marker (_id = "sovereign-default-phase1-federalBudget").
 *
 * CRASH RECOVERY: every write is gated on `sovereignCrisisState: { $exists: false }`.
 * A crash mid-run leaves some documents migrated and others not; rerun resumes.
 *
 * Usage: `MONGODB_URI=... npx tsx scripts/migrations/sovereignDefaultPhase1FederalBudget.ts`
 *        Add `--dry-run` to preview without writing.
 */

import { connectDb, closeDb } from "../../utils/db";
import type { FederalBudget } from "../../../src/lib/db/types/budget";

const MARKER_ID = "sovereign-default-phase1-federalBudget";

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

    // Pre-flight: warn if turn processing is running.
    const gameState = await db
      .collection<{ _id: string; isActive?: boolean; isProcessing?: boolean }>("gameState")
      .findOne({ _id: "current" });
    if (gameState?.isActive || gameState?.isProcessing) {
      console.warn(
        `[${MARKER_ID}] WARNING: gameState.isActive=${gameState.isActive ?? false}, ` +
          `isProcessing=${gameState.isProcessing ?? false}. Turn processing may be running. ` +
          `Continuing in 5 seconds — abort with Ctrl-C if uncertain.`
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    const collection = db.collection<FederalBudget>("federalBudget");
    const candidates = await collection
      .find({ sovereignCrisisState: { $exists: false } })
      .project({ _id: 1, countryId: 1 })
      .toArray();

    console.log(`[${MARKER_ID}] Found ${candidates.length} federalBudget rows needing migration.`);

    if (dryRun) {
      console.log(`[${MARKER_ID}] DRY RUN — no writes performed.`);
      console.log(
        `[${MARKER_ID}] Sample countryIds:`,
        candidates.slice(0, 10).map((d) => d.countryId)
      );
      return;
    }

    let updated = 0;
    for (const doc of candidates) {
      const result = await collection.updateOne(
        { _id: doc._id, sovereignCrisisState: { $exists: false } },
        {
          $set: {
            sovereignCrisisState: "normal",
            failedAuctionConsecutiveCount: 0,
            lastAuctionDemandRatio: 1.0,
            crisisFiredAt: null,
            crisisChoice: null,
            crisisChoiceAt: null,
            crisisLegislativeProposalId: null,
            crisisAutoActionAt: null,
            crisisLegislativeDeadlineAt: null,
            recoveryStartedAt: null,
            recoveryFiscalDisciplineStreak: 0,
            marketAccessLockedUntilTurn: null,
            lastDefaultTurn: null,
            imfSovereignBailoutActive: false,
            imfSovereignFacilityPrincipalOutstanding: 0,
            imfSovereignFacilityAnnualRate: 0,
            imfSovereignFacilityAmortizationTurnsRemaining: 0,
            imfSovereignFacilityIncomeCaptureFraction: 0,
            imfSovereignFacilityImfCorporationId: null,
            imfBoardOverrideWindowEndAt: null,
            imfBoardOverrideAt: null,
            imfBoardOverrideBy: null,
            imfBoardOverrideKind: null,
            imfBoardOverrideRateDelta: null,
            imfBoardOverrideCaptureDelta: null,
            imfBoardPublicStatement: null,
          },
        }
      );
      if (result.modifiedCount > 0) updated++;
    }

    console.log(`[${MARKER_ID}] Updated ${updated}/${candidates.length} documents.`);

    await db
      .collection<MigrationMarker>("migrationsRun")
      .insertOne({ _id: MARKER_ID, completedAt: new Date(), documentsUpdated: updated });
    console.log(`[${MARKER_ID}] Marker written. Migration complete.`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(`[${MARKER_ID}] FAILED:`, err);
  process.exit(1);
});
