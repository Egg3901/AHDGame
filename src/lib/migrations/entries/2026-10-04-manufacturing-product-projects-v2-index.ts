import { MANUFACTURING_PRODUCT_ACTIVE_INDEX_V2 } from "@/lib/products/manufacturingProject";
import type { Migration } from "../types";

/** Enforce one active v2 product project per corporation. */
export const migration: Migration = {
  id: "2026-10-04-manufacturing-product-projects-v2-index",
  description: "Create the active v2 manufacturing product project index.",
  idempotent: true,
  execute: async (db, ctx) => {
    if (!ctx.dryRun) {
      await db.collection("manufacturingProductProjectsV2").createIndex(
        { activeCorporationId: 1 },
        {
          name: MANUFACTURING_PRODUCT_ACTIVE_INDEX_V2,
          unique: true,
          partialFilterExpression: { activeCorporationId: { $exists: true } },
        }
      );
    }
    return {
      documentsScanned: 0,
      documentsUpdated: 0,
      notes: [
        ctx.dryRun
          ? "Would create the active manufacturing product project index"
          : "Created or verified the active manufacturing product project index",
      ],
    };
  },
};
