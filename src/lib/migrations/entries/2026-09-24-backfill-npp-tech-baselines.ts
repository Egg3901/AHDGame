import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { Corporation, GameState } from "@/lib/db/types";
import { autoGrantedNodeIds } from "@/lib/constants/techTree";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import { resolveGameYear } from "@/lib/era/era";
import { isNppOwned } from "@/lib/corporations/nppOwned";
import type { Migration, MigrationContext, MigrationResult } from "../types";

type NppTechRow = Pick<
  Corporation,
  "_id" | "type" | "ceoType" | "caretakerCeo" | "unlockedTechNodeIds"
>;

async function backfillNppTechBaselines(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentYear: 1, currentTurn: 1, startingYear: 1 } }
    );
  const currentYear = resolveGameYear(gameState ?? {}) ?? STARTING_YEAR;
  const corporations = await db
    .collection<NppTechRow>("corporations")
    .find({ ceoType: "npp" })
    .project<NppTechRow>({
      _id: 1,
      type: 1,
      ceoType: 1,
      caretakerCeo: 1,
      unlockedTechNodeIds: 1,
    })
    .toArray();

  const trueNppCorporations = corporations.filter(isNppOwned);
  const operations: AnyBulkWriteOperation<Corporation>[] = [];
  for (const corporation of trueNppCorporations) {
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
      documentsScanned: trueNppCorporations.length,
      documentsUpdated: 0,
      notes: [
        ctx.dryRun
          ? `DRY RUN, no writes. ${operations.length} NPP corporation(s) need passed-decade tech prerequisites.`
          : "No NPP corporations need passed-decade tech prerequisites.",
      ],
    };
  }

  const result = await db.collection<Corporation>("corporations").bulkWrite(operations);
  return {
    documentsScanned: trueNppCorporations.length,
    documentsUpdated: result.modifiedCount,
    notes: [
      `${result.modifiedCount} NPP corporation(s) received passed-decade tech prerequisites for ${currentYear}.`,
    ],
  };
}

export const migration: Migration = {
  id: "2026-09-24-backfill-npp-tech-baselines",
  description:
    "Grant true NPP-owned corporations the passed-decade tech prerequisites omitted by their founding path",
  idempotent: true,
  execute: backfillNppTechBaselines,
};
