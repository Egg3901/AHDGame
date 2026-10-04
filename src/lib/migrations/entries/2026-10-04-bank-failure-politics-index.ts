import type { Migration } from "../types";
export const migration: Migration = {
  id: "2026-10-04-bank-failure-politics-index",
  description: "Bounded recent funded bank-failure political event reads.",
  idempotent: true,
  async execute(db, ctx) {
    if (ctx.dryRun)
      return {
        documentsScanned: 1,
        documentsUpdated: 0,
        notes: ["would create bankFailurePoliticalEvents.paid_turn"],
      };
    await db
      .collection("bankFailurePoliticalEvents")
      .createIndex({ paidTurn: 1 }, { name: "paid_turn" });
    return {
      documentsScanned: 1,
      documentsUpdated: 1,
      notes: ["created/verified bankFailurePoliticalEvents.paid_turn"],
    };
  },
};
