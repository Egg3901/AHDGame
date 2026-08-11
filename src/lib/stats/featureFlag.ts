import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";

/**
 * Master gate for the RPG stat system. When false or absent the system is inert:
 * creation doesn't allocate stats, grandfathered characters aren't prompted, the
 * Debate Prep action and election debates are unavailable, and (since no
 * character has a stat block) every efficacy/drift hook stays neutral.
 */
export async function isRpgStatsEnabled(preloaded?: {
  rpgStatsEnabled?: boolean;
}): Promise<boolean> {
  if (preloaded !== undefined) {
    return preloaded.rpgStatsEnabled === true;
  }
  const db = await getDb();
  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  return gs?.rpgStatsEnabled === true;
}
