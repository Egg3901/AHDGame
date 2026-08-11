import type { Db } from "mongodb";
import { getGameState } from "@/lib/gameState";

const NORMAL_TURN_MS = 3_600_000;
const FAST_TURN_MS = 1_800_000;

export async function queryGameState(db: Db) {
  const state = await getGameState(db);
  if (!state) return null;

  const turnDurationMs = state.fastMode ? FAST_TURN_MS : NORMAL_TURN_MS;

  const BASE_DATE = new Date("2020-01-01T00:00:00Z");
  const gameDateMs = BASE_DATE.getTime() + (state.currentTurn - 1) * 7 * 24 * 3_600_000;
  const gameDate = new Date(gameDateMs).toISOString().split("T")[0];

  return {
    found: true,
    currentTurn: state.currentTurn,
    gameDate,
    nextTurnAt: state.nextScheduledTurn?.toISOString() ?? null,
    turnDurationMs,
  };
}
