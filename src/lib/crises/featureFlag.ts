import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";

/**
 * Check whether the crisis interaction system (decision trees, collective
 * contributions, input nodes) is enabled.
 *
 * When false (or absent), the admin panel shows only the legacy manual crisis
 * creator and the actions page does not render interaction cards.
 *
 * When true, template-based creation, decision trees, and ambient interaction
 * cards are available.
 */
export async function isCrisisInteractionEnabled(preloadedGameState?: {
  crisisInteractionEnabled?: boolean;
}): Promise<boolean> {
  if (preloadedGameState !== undefined) {
    return preloadedGameState.crisisInteractionEnabled === true;
  }
  const db = await getDb();
  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  return gs?.crisisInteractionEnabled === true;
}

export async function isAutoDisastersEnabled(preloadedGameState?: {
  autoDisastersEnabled?: boolean;
}): Promise<boolean> {
  if (preloadedGameState !== undefined) {
    return preloadedGameState.autoDisastersEnabled === true;
  }
  const db = await getDb();
  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  return gs?.autoDisastersEnabled === true;
}

export async function isCrisisAidBillsEnabled(): Promise<boolean> {
  const db = await getDb();
  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  return gs?.crisisAidBillsEnabled === true;
}
