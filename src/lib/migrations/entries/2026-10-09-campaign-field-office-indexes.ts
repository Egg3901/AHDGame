import { ensureFieldOfficeIndexes } from "@/lib/campaigns/fieldOffices/indexes";
import type { Migration } from "../types";

/**
 * Campaign field offices live in their own collection. The unique
 * (campaign, county) index must exist before the first office opens, or two
 * concurrent opens of one county could both land.
 */
export const migration: Migration = {
  id: "2026-10-09-campaign-field-office-indexes",
  description: "Create campaignFieldOffices indexes (election lookup, per-county uniqueness).",
  idempotent: true,
  execute: async (db, ctx) => {
    if (!ctx.dryRun) await ensureFieldOfficeIndexes(db);
    return {
      documentsScanned: 0,
      documentsUpdated: 0,
      notes: [
        ctx.dryRun
          ? "Would create campaignFieldOffices indexes"
          : "Created or verified campaignFieldOffices indexes",
      ],
    };
  },
};
