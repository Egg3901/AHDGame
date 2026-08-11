import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";

/**
 * When false or absent, PREE skips new offers. Pending instances still sweep.
 */
export async function isPlayerRandomEventsEnabled(preloaded?: {
  playerRandomEventsEnabled?: boolean;
}): Promise<boolean> {
  if (preloaded !== undefined) {
    return preloaded.playerRandomEventsEnabled === true;
  }
  const db = await getDb();
  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  return gs?.playerRandomEventsEnabled === true;
}

/**
 * World Events v1 (country-scope) flag. Default false — Phase 0 ships no
 * scheduler, so this only gates the admin manual-trigger route rejecting/
 * accepting offers; it has no other player-visible effect until Phase 1.
 */
export async function isWorldEventsEnabled(preloaded?: {
  worldEventsEnabled?: boolean;
}): Promise<boolean> {
  if (preloaded !== undefined) {
    return preloaded.worldEventsEnabled === true;
  }
  const db = await getDb();
  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  return gs?.worldEventsEnabled === true;
}
