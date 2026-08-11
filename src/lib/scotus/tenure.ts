import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/**
 * Divergent Justice tenure clock (#3598, spec #3581, ahd-scotus-adr-age-agnostic-tenure-clock).
 *
 * A Divergent Justice's tenure end is a flat per-turn hazard: no chance of
 * departure within roughly the first 2 years post-confirmation, then a small
 * constant per-turn probability thereafter, uncapped on the high end.
 * Deliberately age-agnostic — the game has no character age/mortality concept
 * anywhere, and this avoids inventing one just for SCOTUS.
 */

/** Turns after confirmation before the hazard starts rolling at all (~2 years). */
export const DIVERGENT_TENURE_FLOOR_TURNS = 2 * TURNS_PER_YEAR;

/**
 * Flat per-turn probability of departure once the floor has passed. Order of
 * magnitude ~1-2%/turn per spec; tunable against playtesting.
 */
export const DIVERGENT_TENURE_HAZARD_PER_TURN = 0.015;

/**
 * Decide whether a Divergent Justice departs this turn. Pure function — the
 * caller supplies the random draw so this stays deterministic/testable; no
 * DB dependency, no age/mortality concept.
 */
export function rollDivergentDeparture(
  seatedAtTurn: number,
  currentTurn: number,
  randomDraw: number,
  hazardStartsTurn: number = seatedAtTurn + DIVERGENT_TENURE_FLOOR_TURNS,
  hazardPerTurn: number = DIVERGENT_TENURE_HAZARD_PER_TURN
): boolean {
  if (currentTurn < hazardStartsTurn) return false;
  return randomDraw < hazardPerTurn;
}
