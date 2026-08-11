import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";

/**
 * Master gate for the end-of-iteration Season Recap ("Wrapped"). When false or
 * absent the system is inert: `resetGameWorld` builds no recaps, voluntary/admin
 * retirements attach none, and the post-reset gate surfaces nothing. Fail-closed:
 * only an explicit `true` on the gameState singleton enables it. Flipped from the
 * admin Feature Gates panel (`/api/admin/feature-gates`, key `seasonRecapEnabled`).
 * NOT in DEFAULT_GAME_STATE_FLAGS — staged rollout, default off; an explicit
 * enable survives resets (missingGameStateFlagDefaults only fills absent flags).
 */
export async function isSeasonRecapEnabled(preloaded?: {
  seasonRecapEnabled?: boolean;
}): Promise<boolean> {
  if (preloaded !== undefined) {
    return preloaded.seasonRecapEnabled === true;
  }
  const db = await getDb();
  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { seasonRecapEnabled: 1 } });
  return gs?.seasonRecapEnabled === true;
}
