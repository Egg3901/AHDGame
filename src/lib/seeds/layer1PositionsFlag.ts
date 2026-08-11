import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";

/**
 * When false or absent, seed/reseed uses the legacy ideology-modulated archetype
 * lean derivation. When true, archetype econ/social is derived from Layer-1 positions.
 */
export async function isLayer1PositionsEnabled(preloaded?: {
  demographicsLayer1PositionsEnabled?: boolean;
}): Promise<boolean> {
  if (preloaded !== undefined) {
    return preloaded.demographicsLayer1PositionsEnabled === true;
  }
  const db = await getDb();
  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  return gs?.demographicsLayer1PositionsEnabled === true;
}
