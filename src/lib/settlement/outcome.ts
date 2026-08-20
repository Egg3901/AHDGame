/**
 * Threshold tests and the escalation ladder's arithmetic.
 */
import type { SettlementOutcome } from "@/lib/db/types/settlementCrisis";
import {
  CARRY_THRESHOLD,
  LADDER_RUNGS,
  LOCK_THRESHOLD,
  MAX_COERCIVE_RUNG,
} from "@/lib/constants/settlementCrisis";

/** The rung at which the crisis is armed and a declaration unlocks. */
const ARMED_RUNG = LADDER_RUNGS.length;

/** Which side the index has resolved for, or null while it is still in play. */
export function outcomeFor(position: number): SettlementOutcome | null {
  if (position >= CARRY_THRESHOLD) return "challenger";
  if (position <= LOCK_THRESHOLD) return "incumbent";
  return null;
}

/**
 * Next turn's ladder heat.
 *
 * Coercive plays raise it but CANNOT cross to the armed rung: taking the bloc
 * to the brink is a deliberate act by an authority seat, not something that
 * accumulates. A turn where nothing coercive lands decays a rung, so holding
 * the ladder high costs continuous spending rather than being a latch.
 */
export function nextHeat(params: { current: number; added: number }): number {
  const { current, added } = params;
  if (added <= 0) return Math.max(0, current - 1);
  // An already-armed ladder stays armed while coercion continues; the coercive
  // cap must not drag it back down.
  if (current >= ARMED_RUNG) return current;
  return Math.min(MAX_COERCIVE_RUNG, current + added);
}

export function defconFor(heat: number): number {
  return Math.max(1, Math.min(5, 6 - heat));
}

export function isArmed(heat: number): boolean {
  return heat >= ARMED_RUNG;
}
