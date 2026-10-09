import type { Db } from "mongodb";
import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-10-09-market-cap-tick-indexes",
  description: "Index for the 15-minute market cap chart: marketCapTicks by exchange and slot.",
  idempotent: true,
  async execute(db: Db, ctx) {
    if (!ctx.dryRun) {
      await db
        .collection("marketCapTicks")
        .createIndex(
          { exchange: 1, at: 1 },
          { name: "marketCapTicks_exchange_at", background: true }
        );
    }
    return {
      documentsScanned: 0,
      documentsUpdated: ctx.dryRun ? 0 : 1,
      notes: [
        `${ctx.dryRun ? "would create" : "created/verified"} marketCapTicks.marketCapTicks_exchange_at`,
      ],
    };
  },
};
