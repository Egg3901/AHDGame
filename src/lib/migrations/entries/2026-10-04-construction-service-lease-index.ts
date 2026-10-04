import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-10-04-construction-service-lease-index",
  description: "Index unfinished construction instalment epoch leases.",
  idempotent: true,
  execute: async (db, ctx) => {
    if (!ctx.dryRun)
      await db
        .collection("corporations")
        .createIndex(
          { "bankConstructionFunding.service.turn": 1 },
          { name: "corporations_construction_service_turn", sparse: true }
        );
    return {
      documentsUpdated: 0,
      notes: [
        ctx.dryRun
          ? "Would create construction service recovery index"
          : "Created or verified construction service recovery index",
      ],
    };
  },
};
