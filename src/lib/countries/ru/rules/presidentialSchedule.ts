/**
 * Russian presidential ballots have a filing window before their counted campaign.
 * planRussianPresidentialBallot uses a bounded three-month first campaign and
 * the 1991 law's two-week runoff and two-month repeat windows.
 */
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
export type RussianPresidentialBallotKind = "first" | "runoff" | "repeat";
export function planRussianPresidentialBallot(turn: number, kind: RussianPresidentialBallotKind) {
  if (!["first", "runoff", "repeat"].includes(kind) || !Number.isSafeInteger(turn) || turn < 1)
    throw new Error("Russian presidential scheduling needs a valid raw turn");
  const span =
    kind === "first"
      ? TURNS_PER_YEAR / 4
      : kind === "repeat"
        ? TURNS_PER_YEAR / 6
        : TURNS_PER_YEAR / 24;
  const generalSpan = TURNS_PER_YEAR / 24;
  const endTurn = turn + span;
  if (!Number.isSafeInteger(endTurn)) throw new Error("Russian ballot turn exceeds precision");
  return {
    startTurn: turn,
    primaryEndTurn: kind === "runoff" ? turn : endTurn - generalSpan,
    endTurn,
    durationHours: span,
    primaryDurationHours: kind === "runoff" ? 0 : span - generalSpan,
  };
}
