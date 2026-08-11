import { MIN_CORPORATION_DISSOLUTION_AGE_TURNS } from "@/lib/constants/corporations";

export interface DissolutionAgeBlock {
  /** True when the corp is too young for a player to dissolve it. */
  blocked: boolean;
  /** Turns left until dissolution is allowed (0 when not blocked). */
  turnsRemaining: number;
}

/**
 * Whether a player is allowed to dissolve a corporation yet, based on its age.
 * Players cannot dissolve a corp until it is at least
 * {@link MIN_CORPORATION_DISSOLUTION_AGE_TURNS} turns old, which blocks the
 * found → dissolve churn loop. Admin force-liquidate does not use this guard.
 *
 * Corps with no `foundedAtTurn` (founded before that field existed) are exempt.
 */
export function corporationDissolutionAgeBlock(
  foundedAtTurn: number | null | undefined,
  currentTurn: number
): DissolutionAgeBlock {
  if (foundedAtTurn == null) {
    return { blocked: false, turnsRemaining: 0 };
  }
  const age = currentTurn - foundedAtTurn;
  const turnsRemaining = MIN_CORPORATION_DISSOLUTION_AGE_TURNS - age;
  return turnsRemaining > 0
    ? { blocked: true, turnsRemaining }
    : { blocked: false, turnsRemaining: 0 };
}

/** Player-facing message for an age-blocked dissolution attempt. */
export function dissolutionAgeBlockedMessage(turnsRemaining: number): string {
  const turnWord = turnsRemaining === 1 ? "turn" : "turns";
  return `This corporation is too new to dissolve. A corporation must be at least ${MIN_CORPORATION_DISSOLUTION_AGE_TURNS} turns old — ${turnsRemaining} more ${turnWord} to go.`;
}
