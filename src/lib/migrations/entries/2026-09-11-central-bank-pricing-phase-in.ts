import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types";
import type { Migration, MigrationResult } from "../types";

export const migration: Migration = {
  id: "2026-09-11-central-bank-pricing-phase-in",
  description:
    "Anchor the central-bank LOC spread hike and deposit bonus to the live world's current turn.",
  idempotent: true,
  execute: async (db: Db, ctx): Promise<MigrationResult> => {
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { centralBankPricingPhaseIn: 1 } });
    if (!config) {
      return { documentsScanned: 0, documentsUpdated: 0, notes: ["gameConfig is absent"] };
    }

    const startedTurn = config.centralBankPricingPhaseIn?.startedTurn;
    if (typeof startedTurn === "number" && Number.isFinite(startedTurn)) {
      return { documentsScanned: 1, documentsUpdated: 0, notes: ["rollout is already anchored"] };
    }

    const gameState = await db
      .collection<{ _id: string; currentTurn?: number }>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
    const currentTurn =
      typeof gameState?.currentTurn === "number" && Number.isFinite(gameState.currentTurn)
        ? gameState.currentTurn
        : 0;

    if (ctx.dryRun) {
      return {
        documentsScanned: 1,
        documentsUpdated: 0,
        notes: [`would anchor rollout at turn ${currentTurn}`],
      };
    }

    const result = await db
      .collection<GameConfig>("gameConfig")
      .updateOne(
        { _id: "default", "centralBankPricingPhaseIn.startedTurn": { $exists: false } },
        { $set: { "centralBankPricingPhaseIn.startedTurn": currentTurn } }
      );
    return {
      documentsScanned: 1,
      documentsUpdated: result.matchedCount,
      notes: [`rollout anchored at turn ${currentTurn}`],
    };
  },
};
