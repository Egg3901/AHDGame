import type { Db } from "mongodb";
import { isAutoDisastersEnabled } from "@/lib/crises/featureFlag";
import { processAutoCrisisSpawn } from "@/lib/crises/autoCrisisSpawn";

/**
 * Turn phase for the economic/political automatic crises (condition + random
 * tiers). Gated by the same master flag as the regional disaster spawner, so a
 * single admin toggle governs the whole automatic-crisis system.
 */
export async function processAutoCrisisTurn(
  db: Db,
  turn: number,
  preloadedGameState?: { autoDisastersEnabled?: boolean; autoCrisisPaused?: boolean }
): Promise<void> {
  const enabled = await isAutoDisastersEnabled(preloadedGameState);
  if (!enabled) return;
  // Temporary pause: stay enabled but spawn nothing new this turn.
  if (preloadedGameState?.autoCrisisPaused === true) return;
  await processAutoCrisisSpawn(db, turn);
}
