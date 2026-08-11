import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { resolveGameYear } from "@/lib/era/era";

/**
 * Live in-game year for cabinet roster resolution. Null = era-awareness
 * unavailable → callers must fall back to the full roster (rosterEra contract).
 */
export async function getLiveGameYear(db: Db): Promise<number | null> {
  const gs = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentYear: 1, currentTurn: 1, startingYear: 1 } }
    );
  return gs ? resolveGameYear(gs) : null;
}
