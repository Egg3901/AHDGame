import type { Migration } from "../types";

/** Index only: pending LOC owner recovery reads no unrelated character payloads. */
export const migration: Migration = {
  id: "2026-09-30-loc-recovery-owner-index",
  description:
    "Sparse index for protected LOC character outcomes awaiting journal acknowledgement.",
  idempotent: true,
  execute: async (db, ctx) => {
    if (!ctx.dryRun)
      await db
        .collection("characters")
        .createIndex(
          { "pendingLocSettlement.key": 1 },
          { name: "characters_pendingLocSettlement_key", sparse: true }
        );
    return {
      documentsScanned: 0,
      documentsUpdated: 0,
      notes: [
        ctx.dryRun
          ? "Would create LOC recovery owner index"
          : "Created or verified LOC recovery owner index",
      ],
    };
  },
};
