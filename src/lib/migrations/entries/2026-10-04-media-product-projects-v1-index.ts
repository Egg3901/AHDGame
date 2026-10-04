import {
  MEDIA_PRODUCT_ACTIVE_INDEX,
  MEDIA_PRODUCT_CORPORATION_INDEX,
  MEDIA_PRODUCT_PROJECTS,
  MEDIA_PRODUCT_STAGE_INDEX,
} from "@/lib/products/mediaProduct";
import type { Migration } from "../types";

/** Create durable media product lookup and one-active-development indexes before route or turn use. */
export const migration: Migration = {
  id: "2026-10-04-media-product-projects-v1-index",
  description: "Create indexes for media product development and lifecycle reads.",
  idempotent: true,
  execute: async (db, ctx) => {
    if (!ctx.dryRun) {
      const collection = db.collection(MEDIA_PRODUCT_PROJECTS);
      await collection.createIndex(
        { activeDevelopmentCorporationId: 1 },
        {
          name: MEDIA_PRODUCT_ACTIVE_INDEX,
          unique: true,
          partialFilterExpression: { activeDevelopmentCorporationId: { $exists: true } },
        }
      );
      await collection.createIndex(
        { stage: 1, corporationId: 1 },
        { name: MEDIA_PRODUCT_STAGE_INDEX }
      );
      await collection.createIndex(
        { corporationId: 1, stage: 1 },
        { name: MEDIA_PRODUCT_CORPORATION_INDEX }
      );
    }
    return {
      documentsScanned: 0,
      documentsUpdated: 0,
      notes: [
        ctx.dryRun
          ? "Would create active-development, lifecycle, and corporation-history indexes for media product projects"
          : "Created or verified active-development, lifecycle, and corporation-history indexes for media product projects",
      ],
    };
  },
};
