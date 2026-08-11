import { MS_PER_TURN, TURNS_PER_YEAR } from "@/lib/constants/turnTime";

export interface GameDateAnchor {
  currentTurn: number;
  lastTurnProcessed: Date | string;
  /** Game-calendar starting year (e.g. 2019 for 2019-default, 1991 for 1991-default). */
  startingYear: number;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const TURNS_PER_MONTH = TURNS_PER_YEAR / 12; // 4

export function realDateToTurn(eventDate: Date | string, anchor: GameDateAnchor): number {
  const event = typeof eventDate === "string" ? new Date(eventDate) : eventDate;
  const last =
    typeof anchor.lastTurnProcessed === "string"
      ? new Date(anchor.lastTurnProcessed)
      : anchor.lastTurnProcessed;
  const turnsAgo = Math.round((last.getTime() - event.getTime()) / MS_PER_TURN);
  const turn = anchor.currentTurn - turnsAgo;
  return Math.min(anchor.currentTurn, Math.max(1, turn));
}

export function turnToGameMonth(
  turn: number,
  startingYear: number
): { year: number; month: number } {
  const yearOffset = Math.floor((turn - 1) / TURNS_PER_YEAR);
  const weekInYear = (turn - 1) % TURNS_PER_YEAR;
  const month = Math.min(11, Math.floor(weekInYear / TURNS_PER_MONTH));
  return { year: startingYear + yearOffset, month };
}

/** Pre-iteration clock state, read from `GameState`. */
export interface CalendarClock {
  /** `GameState.preIteration?.active` — date is pinned to the era start while true. */
  preIterationActive?: boolean;
  /** `GameState.preIterationTurns` — additive offset once the pre-iteration ends. */
  preIterationTurns?: number;
}

/**
 * Convert a raw `currentTurn` into the DISPLAY calendar turn, honoring the
 * pre-iteration clock. During the pre-iteration (`preIterationActive`) the
 * calendar is pinned to the era start (turn 1) even though the raw turn counter
 * advances; afterward the raw turn is shifted back by `preIterationTurns` so the
 * calendar resumes at the era start the moment the real game begins.
 *
 * On normal (non-pre-iteration) worlds both fields are absent → identity, so
 * `calendarTurn(t) === t`. Election SCHEDULING must keep using the raw turn; only
 * calendar/date DISPLAY should route through this.
 */
export function calendarTurn(rawTurn: number, clock?: CalendarClock): number {
  if (clock?.preIterationActive) return 1;
  return Math.max(1, rawTurn - (clock?.preIterationTurns ?? 0));
}

export function formatGameMonth(eventDate: Date | string, anchor: GameDateAnchor): string {
  const turn = realDateToTurn(eventDate, anchor);
  const { year, month } = turnToGameMonth(turn, anchor.startingYear);
  return `${MONTH_NAMES[month]} ${year}`;
}
