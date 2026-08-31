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
export function isSeasonRecapEnabled(
  preloaded?: {
    seasonRecapEnabled?: boolean | null;
  } | null
): boolean {
  return preloaded?.seasonRecapEnabled === true;
}

/**
 * Same gate, for callers with no gameState in hand. Prefer the sync form and
 * pass the doc you already loaded — this one costs a round trip.
 */
export async function fetchSeasonRecapEnabled(): Promise<boolean> {
  const db = await getDb();
  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { seasonRecapEnabled: 1 } });
  return gs?.seasonRecapEnabled === true;
}
