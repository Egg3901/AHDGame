import {
  ensureProductVentureIndexes,
  PRODUCT_VENTURE_ACTIVE_INDEX,
} from "@/lib/products/venture/store";
import type { Migration } from "../types";

/**
 * Product ventures live in their own collection, so no existing product
 * project document is rewritten. Earlier media and manufacturing projects keep
 * running through their own collections until they retire.
 */
export const migration: Migration = {
  id: "2026-10-08-product-venture-indexes",
  description:
    "Create indexes for product ventures, including one in development per corp and domain.",
  idempotent: true,
  execute: async (db, ctx) => {
    if (!ctx.dryRun) await ensureProductVentureIndexes(db);
    return {
      documentsScanned: 0,
      documentsUpdated: 0,
      notes: [
        ctx.dryRun
          ? `Would create ${PRODUCT_VENTURE_ACTIVE_INDEX} and lookup indexes for product ventures`
          : `Created or verified ${PRODUCT_VENTURE_ACTIVE_INDEX} and lookup indexes for product ventures`,
      ],
    };
  },
};
