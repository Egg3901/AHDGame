import type { Db, Filter } from "mongodb";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { finalizePoleVictory } from "@/lib/military/finalizePoleVictory";
import { eligiblePoleVictor } from "@/lib/military/rules/warResolution";

/**
 * Finalize non-proxy wars that reached a pole before their minimum lifetime elapsed.
 *
 * This must be a turn sweep. A side can arrive at a pole on turn 5 and then file no
 * further offensive; battle resolution will never run again merely because turn 24
 * arrived. The stamp written on arrival is the durable wake-up condition. The caller
 * supplies the conflict gate from its existing game-state snapshot so this adds no
 * redundant game-state round trip to the hourly turn.
 */
export async function resolveMatureWarPoles(
  db: Db,
  currentTurn: number,
  conflictsEnabled: boolean
): Promise<{ finalized: number }> {
  if (!conflictsEnabled) return { finalized: 0 };

  const candidates = await getConflictsCollection(db)
    .find({
      type: { $ne: "cold_war" },
      status: { $in: ["active", "escalating", "winding_down"] },
      poleSide: { $in: ["A", "B"] },
      poleSinceTurn: { $ne: null, $lte: currentTurn },
    } as Filter<ConflictDoc>)
    .toArray();

  let finalized = 0;
  for (const conflict of candidates as ConflictDoc[]) {
    const victor = eligiblePoleVictor({ ...conflict, currentTurn });
    if (!victor) continue;
    if (await finalizePoleVictory(db, conflict, victor, currentTurn)) finalized++;
  }
  return { finalized };
}
