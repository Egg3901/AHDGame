import type { Db } from "mongodb";
import type { ShareTradeHistory } from "@/lib/db/types/shareTradeHistory";
import type { Migration, MigrationContext, MigrationResult } from "../types";

const STRUCTURE_CHANGE_KINDS = ["stock_split", "reverse_split"] as const;

const staleStructureChangeFilter = {
  kind: { $in: STRUCTURE_CHANGE_KINDS },
  $or: [{ shares: { $ne: 0 } }, { pricePerShareAnchor: { $ne: 0 } }, { totalAnchor: { $ne: 0 } }],
};

async function normalizeShareCorporateActions(
  db: Db,
  ctx: MigrationContext
): Promise<MigrationResult> {
  const collection = db.collection<ShareTradeHistory>("shareTradeHistory");
  if (ctx.dryRun) {
    const stale = await collection.countDocuments(staleStructureChangeFilter);
    return {
      documentsScanned: stale,
      documentsUpdated: 0,
      notes: [`DRY RUN, no writes. ${stale} corporate-action rows need normalization`],
    };
  }

  const result = await collection.updateMany(staleStructureChangeFilter, {
    $set: { shares: 0, pricePerShareAnchor: 0, totalAnchor: 0 },
  });
  return {
    documentsScanned: result.matchedCount,
    documentsUpdated: result.modifiedCount,
    notes: [
      `${result.modifiedCount} corporate-action rows normalized; structureChange retains the full share movement`,
    ],
  };
}

export const migration: Migration = {
  id: "2026-09-18-normalize-share-corporate-actions",
  description: "Keep stock splits out of executable share volume and notional",
  idempotent: true,
  execute: normalizeShareCorporateActions,
};
