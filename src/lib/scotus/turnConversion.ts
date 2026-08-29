import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { calendarTurn, type CalendarClock } from "@/lib/utils/gameDate";

/**
 * Convert a calendar year (authored on roster/docket data) to the game turn
 * number at which it should fire, given the preset's starting year. Turn 1 =
 * the first week of `startingYear` (see STARTING_YEAR doc comment in
 * turnTime.ts), so this mirrors the same `(year - startingYear) * TURNS_PER_YEAR`
 * shape used by the election-cycle anchor formulas.
 */
export function yearToTurn(year: number, startingYear: number): number {
  return (year - startingYear) * TURNS_PER_YEAR + 1;
}

/**
 * The earliest authored year whose case fires on or after `turn` — the inverse
 * of {@link yearToTurn}, for callers scheduling a case rather than reading one.
 *
 * Lives next to `yearToTurn` on purpose. This used to be re-derived inline in
 * `crises/optionActions.ts`, and when the docket moved to firing on the CALENDAR
 * turn the copy kept inverting the old raw-turn rule, scheduling challenges a
 * game year late on a world with a founding phase (#1208). One pair, one place.
 *
 * Annual granularity means the case can land up to a year after `turn`; that is
 * inherent in a docket authored by year, not a rounding choice.
 */
export function yearFiringAtOrAfterTurn(
  turn: number,
  startingYear: number,
  clock?: CalendarClock
): number {
  const cal = calendarTurn(turn, clock);
  return startingYear + Math.max(0, Math.ceil((cal - 1) / TURNS_PER_YEAR));
}
