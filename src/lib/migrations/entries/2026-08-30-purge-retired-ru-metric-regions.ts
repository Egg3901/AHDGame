import type { Db } from "mongodb";
import type { Migration, MigrationResult } from "../types";
import { RU_RETIRED_REGION_IDS } from "@/lib/admin/seed/seedRU";

const COLLECTIONS = ["macroMetrics", "politicalMetrics", "stateBaselines", "stateBudgets"] as const;

async function purgeRetiredRuMetricRegions(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const ids = [...RU_RETIRED_REGION_IDS];
  let scanned = 0;
  let deleted = 0;
  const notes: string[] = [];

  for (const collectionName of COLLECTIONS) {
    const collection = db.collection(collectionName);
    const filter = { _id: { $in: ids } as never };
    const found = await collection.countDocuments(filter);
    scanned += found;
    let collectionDeleted = 0;
    if (!dryRun && found > 0) {
      const result = await collection.deleteMany(filter);
      collectionDeleted = result.deletedCount;
      deleted += collectionDeleted;
    }
    notes.push(
      `${collectionName}: ${dryRun ? "would delete" : "deleted"} ${dryRun ? found : collectionDeleted} retired RU region document(s)`
    );
  }

  return {
    documentsScanned: scanned,
    documentsDeleted: dryRun ? 0 : deleted,
    notes,
  };
}

export const migration: Migration = {
  id: "2026-08-30-purge-retired-ru-metric-regions",
  description:
    "Delete retired UKR, BEL, and BLT Russian region documents left after those territories became separate countries.",
  idempotent: true,
  execute: (db, ctx) => purgeRetiredRuMetricRegions(db, ctx.dryRun),
};
