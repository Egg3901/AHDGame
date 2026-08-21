import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";

/**
 * Master gate for settlement crises. Fail-closed: only an explicit `true`
 * enables.
 *
 * Pass `preloaded` when the caller already holds a gameState projection — the
 * turn phase does — so the flag costs no extra round trip.
 */
export async function isSettlementCrisisEnabled(preloaded?: {
  settlementCrisisEnabled?: boolean;
}): Promise<boolean> {
  if (preloaded !== undefined) {
    return preloaded.settlementCrisisEnabled === true;
  }
  const db = await getDb();
  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { settlementCrisisEnabled: 1 } });
  return gs?.settlementCrisisEnabled === true;
}
