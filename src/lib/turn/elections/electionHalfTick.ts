import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { runInAuditContext } from "@/lib/observability/context";
import { accumulateGeneralElectionVotes } from "@/lib/turn/primaryResolution";

/**
 * Half-hour election results tick. Between hourly turns, bank the early half
 * of the coming turn's vote slice for every general election already on the
 * board, so results move every 30 minutes. The coming turn banks the other
 * half before its timers and resolution run, so vote totals, the closing
 * surge and every race deadline (still on the hour) are unchanged. Campaign
 * money and actions stay on the hourly turn.
 *
 * Returns the turn whose early half was banked, or null when the world is
 * inactive, a turn holds the lock, or turns already run every 30 minutes.
 */
export async function runElectionHalfTick(now: Date = new Date()): Promise<number | null> {
  const db = await getDb();
  const state = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentTurn: 1, isActive: 1, isProcessing: 1, fastMode: 1 } }
    );
  if (!state?.isActive || state.isProcessing || state.fastMode) return null;
  const turn = state.currentTurn + 1;
  await runInAuditContext(`election-half-tick:${turn}`, () =>
    accumulateGeneralElectionVotes(now, turn, undefined, { slice: "early" })
  );
  return turn;
}
