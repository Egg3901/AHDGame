import {
  NATIONALIZATION_PRODUCTIVITY_HIT,
  NATIONALIZATION_TRANSITION_TURNS,
  NATIONALIZATION_MAX_TRANSITION_HIT,
} from "./constants";

/**
 * Transition output multiplier for a freshly nationalized sector. Starts at
 * `1 - peakHit` the turn it is taken and recovers linearly to 1.0 over the
 * window. `transitionMultiplier` (the owning country's `sociMultiplier`, ≥ 1)
 * deepens the peak hit AND lengthens the window — a fresh taking digests slower
 * the more the state already owns — while the peak hit is capped at
 * NATIONALIZATION_MAX_TRANSITION_HIT so output never collapses and always
 * recovers. Default 1 = the base 15%/120-turn shock (regression-safe).
 *
 * Returns 1.0 (no drag) when the sector has no nationalization anchor, the turn
 * is unknown, the anchor is in the future, or the (scaled) window has elapsed.
 * Caller gates on state ownership; this is pure time math.
 */
export function nationalizationProductivityFactor(
  nationalizedAtTurn: number | undefined | null,
  currentTurn: number | undefined,
  transitionMultiplier: number = 1
): number {
  if (nationalizedAtTurn == null || currentTurn == null) return 1;
  const mult = Math.max(1, transitionMultiplier);
  const since = currentTurn - nationalizedAtTurn;
  const window = NATIONALIZATION_TRANSITION_TURNS * mult;
  if (since < 0 || since >= window) return 1;
  const remaining = 1 - since / window; // 1 → 0
  const peakHit = Math.min(
    NATIONALIZATION_PRODUCTIVITY_HIT * mult,
    NATIONALIZATION_MAX_TRANSITION_HIT
  );
  return 1 - peakHit * remaining; // (1 - peakHit) → 1.0
}
