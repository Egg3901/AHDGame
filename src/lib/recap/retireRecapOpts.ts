import type { Db } from "mongodb";
import type { Character, GameState } from "@/lib/db/types";
import type { GameIteration } from "@/lib/db/types/gameState";
import type { CharacterRecap } from "./types";
import { buildSoloRecap } from "./buildSeasonRecaps";

/**
 * Build the `retireCharacter` opts ({ iteration, recap }) for a single
 * mid-season retirement (voluntary or admin). Returns {} when the Season Recap
 * gate is off, so callers can spread it unconditionally.
 *
 * Best-effort: a recap-build failure must NEVER block the retirement itself, so
 * any error is swallowed and the retire proceeds without a recap. Must be called
 * BEFORE `retireCharacter` (which deletes the character's actionLogs).
 */
export async function buildRetireRecapOpts(
  db: Db,
  character: Character
): Promise<{ iteration?: GameIteration; recap?: CharacterRecap }> {
  try {
    const gs = await db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { iteration: 1, currentTurn: 1, seasonRecapEnabled: 1 } }
      );
    if (gs?.seasonRecapEnabled !== true) return {};
    const recap = await buildSoloRecap(db, character, {
      iteration: gs.iteration,
      currentTurn: gs.currentTurn ?? 1,
    });
    return { iteration: gs.iteration, recap: recap ?? undefined };
  } catch {
    return {};
  }
}
