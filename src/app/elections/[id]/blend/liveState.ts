import type { ElectionDetail } from "../components/ElectionDetailTypes";
import { FINAL_STRETCH_TURNS } from "./generalBlendViewModel";

/**
 * Whether a presidential race has results coming in right now, which is the
 * only time the screen should say "live": the wire ticker, the live tally
 * kicker and the "Live results" link.
 *
 * - Primary season: once any wave has voted, there are returns.
 * - General: the final stretch, the window the screen itself calls Election
 *   Night. Before it the campaign is running but nothing is being called.
 * - Concluded: never; the result is final.
 */
export function presidentialResultsLive(election: ElectionDetail): boolean {
  if (election.isEnded || election.isUpcoming) return false;
  if (election.inPrimary) {
    return (election.primaryCalendar ?? []).some((w) => w.status === "complete");
  }
  const currentTurn = election.gameState?.currentTurn ?? null;
  if (currentTurn == null || election.endTurn == null) return false;
  return Math.max(0, election.endTurn - currentTurn) <= FINAL_STRETCH_TURNS;
}
