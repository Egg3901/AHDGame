import { ensureAdvertisingAgreementIndexes } from "@/lib/advertising/persistence";
import type { Migration } from "../types";

/** Create advertising agreement and settlement indexes before the first agreement route or turn read. */
export const migration: Migration = {
  id: "2026-10-05-advertising-agreement-indexes",
  description: "Create indexes for advertising agreements and per-turn settlements.",
  idempotent: true,
  execute: async (db, ctx) => {
    if (!ctx.dryRun) await ensureAdvertisingAgreementIndexes(db);
    return {
      documentsScanned: 0,
      documentsUpdated: 0,
      notes: [
        ctx.dryRun
          ? "Would create party, buyer-status and corporation-turn indexes for advertising agreements"
          : "Created or verified party, buyer-status and corporation-turn indexes for advertising agreements",
      ],
    };
  },
};
