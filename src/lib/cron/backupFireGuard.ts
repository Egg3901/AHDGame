import type { GameState } from "@/lib/db/types";
import { getLatestCompletedTurnRealTime } from "@/lib/turn/turnLogQueries";

export function clockHourBucket(date: Date): number {
  return Math.floor(date.getTime() / (60 * 60 * 1000));
}

/**
 * Determines whether a backup turn at :30 should fire.
 * In normal mode, the backup only fires if no turn completed in the current clock hour.
 * In fast mode, both :00 and :30 are legitimate turns, so this always returns true.
 */
export async function shouldFireBackupTurn(now: Date, gameState: GameState): Promise<boolean> {
  // The backup fire only suppresses itself in normal mode. In fast mode both :00 and
  // :30 are legitimate scheduled turns, so the backup proceeds unconditionally — same
  // as the primary.
  if (gameState.fastMode) {
    return true;
  }

  const latestCompletedTurnAt = await getLatestCompletedTurnRealTime(gameState);
  const alreadyRanThisHour =
    latestCompletedTurnAt && clockHourBucket(latestCompletedTurnAt) === clockHourBucket(now);

  return !alreadyRanThisHour;
}
