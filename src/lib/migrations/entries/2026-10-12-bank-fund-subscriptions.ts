import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-10-12-bank-fund-subscriptions",
  description: "Index next-turn subscription receipts without changing existing fund rights.",
  idempotent: true,
  async execute(db) {
    await db
      .collection("indexFundCommands")
      .createIndex(
        { "subscription.status": 1, "subscription.dueTurn": 1, "subscription.fundId": 1 },
        { name: "indexFundCommands_due_subscriptions" }
      );
    await db
      .collection("indexFundCommands")
      .createIndex(
        { "subscription.fundId": 1, "subscription.characterId": 1, "subscription.status": 1 },
        { name: "indexFundCommands_viewer_subscriptions" }
      );
    return {};
  },
};
