/**
 * Russian Duma ballots allow a bounded three-month filing and campaign window.
 * planRussianDumaBallot uses raw turns, with the final two turns for counted voting;
 * a late political mandate moves the campaign rather than inventing a past election.
 */
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

export function planRussianDumaBallot(turn: number) {
  if (!Number.isSafeInteger(turn) || turn < 1)
    throw new Error("Russian Duma scheduling needs a valid raw turn");
  const durationHours = TURNS_PER_YEAR / 4;
  const generalSpan = TURNS_PER_YEAR / 24;
  const endTurn = turn + durationHours;
  if (!Number.isSafeInteger(endTurn)) throw new Error("Russian Duma ballot exceeds turn precision");
  return {
    startTurn: turn,
    primaryEndTurn: endTurn - generalSpan,
    endTurn,
    durationHours,
    primaryDurationHours: durationHours - generalSpan,
  };
}
