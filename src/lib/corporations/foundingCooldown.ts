import { CORPORATION_FOUNDING_COOLDOWN_TURNS } from "@/lib/constants/corporations";

/**
 * Turns remaining before a user may found another corporation (Bug #0728).
 * Returns 0 when the user may found now — including their first-ever founding
 * (no `lastCorporationFoundedTurn`). Per-user cooldown that prevents the
 * found → drain → abandon → found rotation which dodged the per-corp bond cooldown.
 */
export function foundingCooldownTurnsRemaining(
  lastCorporationFoundedTurn: number | null | undefined,
  currentTurn: number
): number {
  if (lastCorporationFoundedTurn == null) return 0;
  // A stale value from before a world reset: the recorded turn is ahead of
  // the current turn, which is impossible in normal play. Treat as no cooldown.
  if (lastCorporationFoundedTurn > currentTurn) return 0;
  return Math.max(
    0,
    lastCorporationFoundedTurn + CORPORATION_FOUNDING_COOLDOWN_TURNS - currentTurn
  );
}
