import { COUNTER_INTEL_DEFAULT, COUNTER_INTEL_MAX } from "./config";

/** Facts already tracked elsewhere in the game. Nothing new is persisted for this. */
export interface CounterIntelFacts {
  /** Is the country a belligerent in any active conflict. */
  atWar: boolean;
  /** Its largest single pole share, 0..100, from CountryAlignment. */
  alignedShare: number;
  /** Global cold-war tension, 0..100. */
  tensionValue: number;
  /** Security estates the country has built. */
  securityEstateCount: number;
}

function clampInput(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, value));
}

/**
 * An NPP country's defensive posture, derived fresh each turn.
 *
 * Deliberately derived rather than stored: no player sets it, so a stored value
 * would never move and every NPP country would defend identically forever. It is
 * computed whether or not NPP OPERATIONS are enabled — that switch governs
 * whether an NPP country acts, never whether it resists. Defence needs no order.
 */
export function deriveCounterIntel(facts: CounterIntelFacts): number {
  const war = facts.atWar ? 25 : 0;
  const bloc = 0.15 * clampInput(facts.alignedShare, 100);
  const tension = 0.2 * clampInput(facts.tensionValue, 100);
  const estates = 3 * clampInput(facts.securityEstateCount, Number.MAX_SAFE_INTEGER);
  const raw = COUNTER_INTEL_DEFAULT + war + bloc + tension + estates;
  return Math.round(Math.max(0, Math.min(COUNTER_INTEL_MAX, raw)));
}
