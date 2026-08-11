import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

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
