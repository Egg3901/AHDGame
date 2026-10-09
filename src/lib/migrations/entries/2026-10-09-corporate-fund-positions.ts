import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-10-09-corporate-fund-positions",
  description: "Unique corporate fund positions and corporate portfolio lookup index.",
  idempotent: true,
  async execute(db, ctx) {
    if (!ctx.dryRun) {
      await db.collection("indexFundPositions").createIndex(
        { fundId: 1, corporationId: 1 },
        {
          name: "fund_corporation_unique",
          unique: true,
          partialFilterExpression: { holderKind: "corporation" },
        }
      );
      await db
        .collection("indexFundPositions")
        .createIndex(
          { corporationId: 1, holderKind: 1 },
          { name: "corporation_fund_portfolio", sparse: true }
        );
    }
    return {
      documentsScanned: 0,
      documentsUpdated: ctx.dryRun ? 0 : 2,
      notes: ["Corporate holder fields are additive; existing positions are unchanged."],
    };
  },
};
