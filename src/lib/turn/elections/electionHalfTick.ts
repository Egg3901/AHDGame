import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { runInAuditContext } from "@/lib/observability/context";
import {
  accumulateGeneralElectionVotes,
  recordPrimarySnapshots,
} from "@/lib/turn/primaryResolution";

/**
 * Half-hour election results tick. Between hourly turns, bank the early half
 * of the coming turn's vote slice so results move every 30 minutes:
 * - every general election already counting general turns, on every engine
 *   (state races, ranked PR-STV, the bespoke national ballots and both
 *   presidential engines);
 * - non-presidential primaries whose turn-bounded ballot window is open.
 * The coming turn banks the other half before its timers and resolution run,
 * so vote totals, the closing surge and every race deadline (still on the
 * hour) are unchanged. Campaign money and actions, presidential primary waves
 * and the presidential primary polling projection stay on the hourly turn.
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
  await runInAuditContext(`election-half-tick:${turn}`, async () => {
    // Primaries run even when a general race failed; the failure still surfaces.
    let generalFailure: unknown;
    try {
      await accumulateGeneralElectionVotes(now, turn, undefined, { slice: "early" });
    } catch (error) {
      generalFailure = error;
    }
    await recordPrimarySnapshots(now, turn, undefined, { slice: "early" });
    if (generalFailure) throw generalFailure;
  });
  return turn;
}
