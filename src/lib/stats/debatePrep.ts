import {
  DEBATE_PREP_SUCCESS_CHANCE,
  DEBATE_PRACTICE_WIN_CHANCE,
  DEBATE_PRACTICE_BASE_CHANCE,
  STAT_MAX,
} from "./statsConstants";

export interface DebatePrepResult {
  success: boolean;
  /** Debate value after the attempt (unchanged on failure or at cap). */
  debate: number;
}

/**
 * Resolve one Debate Prep attempt. `rng` returns a float in [0, 1) (e.g.
 * Math.random). Success (`rng() < 15%`) raises Debate by 1, clamped at the cap.
 * Injecting `rng` keeps this deterministically testable.
 */
export function rollDebatePrep(rng: () => number, currentDebate: number): DebatePrepResult {
  const success = rng() < DEBATE_PREP_SUCCESS_CHANCE;
  if (!success) return { success: false, debate: currentDebate };
  return { success: true, debate: Math.min(STAT_MAX, currentDebate + 1) };
}

/**
 * Resolve a debate-*participation* practice roll. You get better at debating by
 * debating: every resolved debate gives a character participant a chance to +1
 * Debate, with the winner learning more than the loser. `rng` returns [0, 1).
 * Already-capped stats are left unchanged.
 */
export function rollDebatePractice(
  rng: () => number,
  currentDebate: number,
  won: boolean
): DebatePrepResult {
  const chance = won ? DEBATE_PRACTICE_WIN_CHANCE : DEBATE_PRACTICE_BASE_CHANCE;
  const success = rng() < chance && currentDebate < STAT_MAX;
  if (!success) return { success: false, debate: currentDebate };
  return { success: true, debate: Math.min(STAT_MAX, currentDebate + 1) };
}
