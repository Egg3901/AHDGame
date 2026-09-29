import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-09-29-union-prosecution-bar-index",
  description: "Index active union prosecution bars by character and turn.",
  idempotent: true,
  async execute(db, ctx) {
    if (!ctx.dryRun) {
      await db
        .collection("unionOrganizers")
        .createIndex(
          { characterId: 1, barredUntilTurn: 1 },
          { name: "union_prosecution_bar_by_character", background: true }
        );
    }
    return {
      documentsScanned: 0,
      documentsUpdated: ctx.dryRun ? 0 : 1,
      notes: [
        `${ctx.dryRun ? "would create" : "created/verified"} union_prosecution_bar_by_character`,
      ],
    };
  },
};
