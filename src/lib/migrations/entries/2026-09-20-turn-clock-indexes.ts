import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-09-20-turn-clock-indexes",
  description: "Index successful turn clock reconciliation for existing worlds",
  idempotent: true,
  async execute(db, ctx) {
    if (ctx.dryRun) return { notes: ["Would create successful turn clock indexes."] };
    const logs = db.collection("turnLogs");
    await logs.createIndex(
      { success: 1, "iteration.type": 1, "iteration.number": 1, turn: -1, gameTime: -1 },
      { name: "turnLogs_success_iteration_clock" }
    );
    await logs.createIndex(
      { success: 1, turn: -1, gameTime: -1 },
      { name: "turnLogs_success_clock" }
    );
    return { notes: ["Created or verified successful turn clock indexes."] };
  },
};
