import type { Db } from "mongodb";
import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-09-26-market-chart-indexes",
  description:
    "Indexes for the market candle chart: share trades by turn+kind (splits, turnover) and intraday levels by exchange+turn.",
  idempotent: true,
  async execute(db: Db, ctx) {
    const specs: { collection: string; keys: { [key: string]: 1 | -1 }; name: string }[] = [
      {
        collection: "shareTradeHistory",
        keys: { turn: 1, kind: 1 },
        name: "shareTradeHistory_turn_kind",
      },
      {
        collection: "marketIndexIntraday",
        keys: { exchange: 1, turn: 1 },
        name: "marketIndexIntraday_exchange_turn",
      },
    ];
    const notes: string[] = [];
    for (const spec of specs) {
      if (!ctx.dryRun) {
        await db
          .collection(spec.collection)
          .createIndex(spec.keys, { name: spec.name, background: true });
      }
      notes.push(
        `${ctx.dryRun ? "would create" : "created/verified"} ${spec.collection}.${spec.name}`
      );
    }
    return { documentsScanned: 0, documentsUpdated: ctx.dryRun ? 0 : specs.length, notes };
  },
};
