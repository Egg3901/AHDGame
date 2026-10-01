import type { ConflictStatus, ConflictType } from "@/lib/db/types/conflict";
import type { Side } from "@/lib/military/occupation";

/**
 * Minimum lifetime of a non-proxy war before control of all host territory may
 * end it. One turn is one real hour, so this guarantees one full day in which
 * both governments can react to the outbreak.
 *
 * BALANCE CONSTANT. Changing it needs an issue and a simulation report.
 */
export const MIN_NON_PROXY_WAR_TURNS = 24;

export interface PoleVictoryInput {
  type: ConflictType;
  status: ConflictStatus;
  /** Absent on legacy conflicts, which are treated as old enough to preserve playability. */
  startTurn?: number;
  currentTurn: number;
  control: number;
  /** Stamped only when battle movement arrives at a pole, never merely because it starts there. */
  poleSide?: Side | null;
  poleSinceTurn?: number | null;
}

/** Which side physically holds the whole host, if either. */
export function sideAtPole(control: number): Side | null {
  return control === 0 ? "A" : control === 100 ? "B" : null;
}

/**
 * The side eligible to win a mature non-proxy war, or null while fighting must continue.
 *
 * `poleSinceTurn` is the proof that the front MOVED to this pole. A defender begins an
 * interstate war holding all of its own soil, but creation writes no pole stamp. That
 * opening position therefore cannot turn into a free victory when the age gate elapses.
 */
export function eligiblePoleVictor(input: PoleVictoryInput): Side | null {
  if (input.type === "cold_war") return null;
  if (input.status === "resolved" || input.status === "terms_pending") return null;

  const actual = sideAtPole(input.control);
  if (!actual || input.poleSide !== actual || input.poleSinceTurn == null) return null;
  if (!Number.isFinite(input.poleSinceTurn) || input.poleSinceTurn > input.currentTurn) return null;

  // Legacy conflicts without a usable start turn predate the duration rule. Treat them
  // as mature rather than leaving a live war permanently unable to finish.
  if (input.startTurn != null && Number.isFinite(input.startTurn)) {
    if (input.poleSinceTurn < input.startTurn) return null;
    if (input.currentTurn - input.startTurn < MIN_NON_PROXY_WAR_TURNS) return null;
  }

  return actual;
}
