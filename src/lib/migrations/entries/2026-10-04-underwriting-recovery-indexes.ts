import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-10-04-underwriting-recovery-indexes",
  description: "Index founding IPO plans and original-epoch underwriting leases for recovery.",
  idempotent: true,
  execute: async (db, ctx) => {
    if (!ctx.dryRun) {
      await db
        .collection("corporations")
        .createIndex(
          { "bankUnderwritingFunding.turn": 1 },
          { name: "corporations_underwriting_funding_turn", sparse: true }
        );
      await db
        .collection("corporations")
        .createIndex(
          { "foundingIpoUnderwritingPending.offer.instrumentId": 1 },
          { name: "corporations_founding_ipo_underwriting_instrument", sparse: true }
        );
    }
    return {
      documentsUpdated: 0,
      notes: [
        ctx.dryRun
          ? "Would create underwriting lease and founding-plan recovery indexes"
          : "Created or verified underwriting recovery indexes",
      ],
    };
  },
};
