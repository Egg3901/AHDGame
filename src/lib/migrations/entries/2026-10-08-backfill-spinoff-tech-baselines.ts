import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { Corporation, GameState } from "@/lib/db/types";
import { autoGrantedNodeIds } from "@/lib/constants/techTree";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import { resolveGameYear } from "@/lib/era/era";
import type { Migration, MigrationContext, MigrationResult } from "../types";

type SpinOffTechRow = Pick<Corporation, "_id" | "type" | "unlockedTechNodeIds">;

/**
 * Spin-off subsidiaries were created with no tech at all (suggestion #363).
 * Grant each the passed-decade baseline a newly founded corp of its type gets.
 * Additive only: nothing researched since the spin-off is touched.
 */
async function backfillSpinOffTechBaselines(
  db: Db,
  ctx: MigrationContext
): Promise<MigrationResult> {
  const gameState = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: { currentYear: 1, currentTurn: 1, startingYear: 1, sectorTechTreesEnabled: 1 },
    }
  );
  if (gameState?.sectorTechTreesEnabled !== true) {
    return {
      documentsScanned: 0,
      documentsUpdated: 0,
      notes: ["Sector tech trees are off; nothing to grant."],
    };
  }
  const currentYear = resolveGameYear(gameState) ?? STARTING_YEAR;
  const corporations = await db
    .collection<SpinOffTechRow>("corporations")
    .find({ isSpinOff: true })
    .project<SpinOffTechRow>({ _id: 1, type: 1, unlockedTechNodeIds: 1 })
    .toArray();

  const operations: AnyBulkWriteOperation<Corporation>[] = [];
  for (const corporation of corporations) {
    const owned = new Set(corporation.unlockedTechNodeIds ?? []);
    const missing = autoGrantedNodeIds(corporation.type, currentYear).filter(
      (nodeId) => !owned.has(nodeId)
    );
    if (missing.length === 0) continue;
    operations.push({
      updateOne: {
        filter: { _id: corporation._id },
        update: {
          $addToSet: { unlockedTechNodeIds: { $each: missing } },
          $set: { updatedAt: new Date() },
        },
      },
    });
  }

  if (ctx.dryRun || operations.length === 0) {
    return {
      documentsScanned: corporations.length,
      documentsUpdated: 0,
      notes: [
        ctx.dryRun
          ? `DRY RUN, no writes. ${operations.length} spin-off corporation(s) need baseline tech.`
          : "No spin-off corporations need baseline tech.",
      ],
    };
  }

  const result = await db.collection<Corporation>("corporations").bulkWrite(operations);
  return {
    documentsScanned: corporations.length,
    documentsUpdated: result.modifiedCount,
    notes: [
      `${result.modifiedCount} spin-off corporation(s) received passed-decade baseline tech for ${currentYear}.`,
    ],
  };
}

export const migration: Migration = {
  id: "2026-10-08-backfill-spinoff-tech-baselines",
  description: "Grant spin-off subsidiaries the passed-decade baseline tech a new corporation gets",
  idempotent: true,
  execute: backfillSpinOffTechBaselines,
};
