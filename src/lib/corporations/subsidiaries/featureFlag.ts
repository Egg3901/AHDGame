import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";

/**
 * Subsidiary-corporations feature gate. Default ON for fresh worlds
 * (featureFlagDefaults); fail-closed on any world that never stamped the flag.
 *
 * Pass `preloadedGameState` when the caller already has the game-state singleton
 * in hand (avoids a redundant round-trip). Import this dynamically inside the
 * turn processor to avoid circular deps.
 */
export async function isSubsidiaryCorporationsEnabled(preloadedGameState?: {
  subsidiaryCorporationsEnabled?: boolean;
}): Promise<boolean> {
  if (preloadedGameState) return preloadedGameState.subsidiaryCorporationsEnabled === true;
  const db = await getDb();
  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { subsidiaryCorporationsEnabled: 1 } });
  return gs?.subsidiaryCorporationsEnabled === true;
}
