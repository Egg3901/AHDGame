import { getDb } from "@/lib/mongodb";
import type { GameState, TurnLog } from "@/lib/db/types";

/** Turn logs at or below the persisted turn counter for the current game iteration. */
export function buildCompletedTurnFilter(gameState: GameState): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    // Critical failures can still emit a crash turnLog for the attempted next turn
    // before GameState.currentTurn advances. Restrict cron guards to persisted turns
    // so a :30 recovery fire is still allowed after a hard crash.
    turn: { $lte: gameState.currentTurn },
  };

  // Resetting the world bumps GameState.iteration, so guards must only look at turn
  // logs from the current run or an old iteration can suppress fresh-world cron work.
  if (gameState.iteration) {
    filter["iteration.type"] = gameState.iteration.type;
    filter["iteration.number"] = gameState.iteration.number;
    return filter;
  }

  filter.$or = [{ iteration: { $exists: false } }, { iteration: null }];
  return filter;
}

/** Wall-clock time of the most recent completed turn log for this game iteration. */
export async function getLatestCompletedTurnRealTime(gameState: GameState): Promise<Date | null> {
  const db = await getDb();
  const latestTurn = await db
    .collection<TurnLog>("turnLogs")
    .find(buildCompletedTurnFilter(gameState), { projection: { realTime: 1, createdAt: 1 } })
    .sort({ realTime: -1, createdAt: -1 })
    .limit(1)
    .toArray()
    .then((logs) => logs[0] ?? null);

  const latestTimestamp = latestTurn?.realTime ?? latestTurn?.createdAt ?? null;
  return latestTimestamp ? new Date(latestTimestamp) : null;
}
