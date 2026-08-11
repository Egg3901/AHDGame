import type { GameState } from "@/lib/db/types";

/**
 * Master gate for the live election results page. Lives on the gameState
 * singleton and is flipped from the admin Feature Gates panel
 * (`/api/admin/feature-gates`, key `liveElectionResultsEnabled`). Default off.
 */
export function isLiveElectionResultsEnabled(
  gameState: Pick<GameState, "liveElectionResultsEnabled"> | null | undefined
): boolean {
  return gameState?.liveElectionResultsEnabled === true;
}
