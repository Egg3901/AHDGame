import type { Db } from "mongodb";
import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-09-25-federal-budget-snapshot-history-index",
  description: "Index federal budget history by country and descending turn.",
  idempotent: true,
  async execute(db: Db, ctx) {
    const indexName = "federalBudgetSnapshots_country_turn";
    if (!ctx.dryRun) {
      await db
        .collection("federalBudgetSnapshots")
        .createIndex({ countryId: 1, turn: -1 }, { name: indexName });
    }
    return {
      documentsScanned: 0,
      documentsUpdated: ctx.dryRun ? 0 : 1,
      notes: [
        `${ctx.dryRun ? "would create" : "created/verified"} federalBudgetSnapshots.${indexName}`,
      ],
    };
  },
};
