import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/**
 * Divergent Justice tenure clock (#3598, spec #3581, ahd-scotus-adr-age-agnostic-tenure-clock).
 *
 * A Divergent Justice's tenure end is a flat per-turn hazard: no chance of
 * departure within roughly the first 2 years post-confirmation, then a small
 * constant per-turn probability thereafter, uncapped on the high end.
 * Deliberately age-agnostic — the game has no character age/mortality concept
 * anywhere, and this avoids inventing one just for SCOTUS.
 *
 * The clock applies to player-held seats as well as generated NPPs (ticket
 * #1135). Without it, a confirmed player stays on the Court forever. Callers
 * must notify the occupant and surface the death chance in the UI; silently
 * vacating is the actual bug.
 */

/** Turns after confirmation before the hazard starts rolling at all (~2 years). */
export const DIVERGENT_TENURE_FLOOR_TURNS = 2 * TURNS_PER_YEAR;

/**
 * Flat per-turn probability of departure once the floor has passed. Order of
 * magnitude ~1-2%/turn per spec; tunable against playtesting.
 */
export const DIVERGENT_TENURE_HAZARD_PER_TURN = 0.015;

/** Player-facing death chance for an occupied Divergent seat. */
export interface DivergentDeathChance {
  /** Per-turn probability. 0 while the floor still holds. */
  chancePerTurn: number;
  /** Turns remaining until the hazard starts. 0 once it is live. */
  turnsUntilActive: number;
}

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

/**
 * Live death chance for a Divergent Justice. Returns null when the seat has
 * no hazard clock (historical occupant, vacant, or missing stamp).
 */
export function divergentDeathChance(
  currentTurn: number,
  hazardStartsTurn: number | null | undefined
): DivergentDeathChance | null {
  if (hazardStartsTurn == null) return null;
  const turnsUntilActive = Math.max(0, hazardStartsTurn - currentTurn);
  return {
    chancePerTurn: turnsUntilActive > 0 ? 0 : DIVERGENT_TENURE_HAZARD_PER_TURN,
    turnsUntilActive,
  };
}

/** Percent label for the live hazard, e.g. "1.5%". */
export function formatDeathChancePercent(
  chancePerTurn: number = DIVERGENT_TENURE_HAZARD_PER_TURN
): string {
  return `${(chancePerTurn * 100).toFixed(1)}%`;
}

/**
 * Player-facing death-chance copy. Compact for seat cards; full for the
 * Justice office. No em/en dashes.
 */
export function formatDivergentDeathChance(
  chance: DivergentDeathChance,
  style: "compact" | "full" = "full"
): string {
  const livePct = formatDeathChancePercent();
  if (chance.turnsUntilActive > 0) {
    const n = chance.turnsUntilActive;
    const unit = n === 1 ? "turn" : "turns";
    if (style === "compact") {
      return `0% death chance (${n} ${unit} until ${livePct})`;
    }
    return `No death chance yet. ${livePct} per turn starts in ${n} ${unit}.`;
  }
  return `${livePct} death chance per turn`;
}
