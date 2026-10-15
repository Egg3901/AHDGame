import type { Db } from "mongodb";
import type { GameState, NppAutonomyLevel } from "@/lib/db/types/gameState";
import { isSingleplayer } from "@/lib/singleplayer";
import type { Migration, MigrationResult } from "../types";

/** Hosted levels this migration raises. Lower levels and "off" were chosen on purpose. */
const RAISED_LEVELS: readonly NppAutonomyLevel[] = ["v4", "v5"];
const TARGET_LEVEL: NppAutonomyLevel = "v6";
const ACTOR = "migration:2026-10-15-live-world-npp-autonomy-v6";

/**
 * Moves a hosted world running autonomy v4 or v5 onto v6 so it runs NPP
 * engine 6. Singleplayer worlds keep the level their player chose. Runs once
 * per database (marker-gated), so a later admin change is never overwritten.
 */
export const migration: Migration = {
  id: "2026-10-15-live-world-npp-autonomy-v6",
  description: "Raise a hosted world's NPP autonomy from v4 or v5 to v6 (NPP engine 6).",
  idempotent: true,
  execute: async (db: Db, ctx): Promise<MigrationResult> => {
    if (isSingleplayer()) {
      return { documentsScanned: 0, documentsUpdated: 0, notes: ["singleplayer: level kept"] };
    }

    const state = await db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { nppAutonomyLevel: 1, singleplayerConfig: 1, currentTurn: 1 } }
      );
    if (!state) {
      return { documentsScanned: 0, documentsUpdated: 0, notes: ["gameState is absent"] };
    }
    if (state.singleplayerConfig) {
      return {
        documentsScanned: 1,
        documentsUpdated: 0,
        notes: ["singleplayer world: level kept"],
      };
    }

    const level = state.nppAutonomyLevel;
    if (!level || !RAISED_LEVELS.includes(level)) {
      return {
        documentsScanned: 1,
        documentsUpdated: 0,
        notes: [`level ${level ?? "unset"} kept`],
      };
    }

    if (ctx.dryRun) {
      return {
        documentsScanned: 1,
        documentsUpdated: 0,
        notes: [`would raise ${level} to ${TARGET_LEVEL} at turn ${state.currentTurn ?? "?"}`],
      };
    }

    const nowIso = new Date().toISOString();
    const result = await db.collection<GameState>("gameState").updateOne(
      {
        _id: "current",
        nppAutonomyLevel: { $in: [...RAISED_LEVELS] },
        singleplayerConfig: { $exists: false },
      },
      {
        $set: {
          nppAutonomyLevel: TARGET_LEVEL,
          nppAutonomyEnabled: true,
          nppAutonomyEnabledBy: ACTOR,
          nppAutonomyEnabledAt: nowIso,
          updatedAt: new Date(),
        },
      }
    );
    return {
      documentsScanned: 1,
      documentsUpdated: result.modifiedCount,
      notes: [`raised ${level} to ${TARGET_LEVEL} at turn ${state.currentTurn ?? "?"}`],
    };
  },
};
