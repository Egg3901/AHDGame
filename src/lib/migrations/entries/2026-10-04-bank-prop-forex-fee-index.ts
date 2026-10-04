import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-10-04-bank-prop-forex-fee-index",
  description: "Index original funded bank forex fees awaiting settlement.",
  idempotent: true,
  execute: async (db, ctx) => {
    if (!ctx.dryRun)
      await db
        .collection("corporations")
        .createIndex(
          { "bankPropForexFee.turn": 1 },
          { name: "corporations_bankPropForexFee_turn", sparse: true }
        );
    return {
      documentsUpdated: 0,
      notes: [
        ctx.dryRun
          ? "Would create forex fee recovery index"
          : "Created or verified forex fee recovery index",
      ],
    };
  },
};
