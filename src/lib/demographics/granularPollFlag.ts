import type { GameState } from "@/lib/db/types/gameState";

/**
 * Runtime gate for granular poll breakdowns.
 * Fail-closed: absent reads as false so existing worlds keep legacy poll
 * results until an admin enables the gate.
 */
export function isGranularPollEnabled(
  gameState: Pick<GameState, "granularPollEnabled"> | null | undefined
): boolean {
  return gameState?.granularPollEnabled === true;
}
