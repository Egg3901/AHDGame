import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";

/**
 * Whether the decade-gated sector tech-tree system is enabled.
 *
 * When false (or absent), the corporation Tech tab is hidden, the unlock API
 * rejects, and the turn engine applies no tech effects — the feature is fully
 * inert. Mirrors isCrisisInteractionEnabled (src/lib/crises/featureFlag.ts).
 */
export async function isSectorTechTreesEnabled(preloadedGameState?: {
  sectorTechTreesEnabled?: boolean;
}): Promise<boolean> {
  if (preloadedGameState !== undefined) {
    return preloadedGameState.sectorTechTreesEnabled === true;
  }
  const db = await getDb();
  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  return gs?.sectorTechTreesEnabled === true;
}
