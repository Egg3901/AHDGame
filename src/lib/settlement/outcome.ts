/**
 * Threshold tests and the escalation ladder's arithmetic.
 */
import type { SettlementOutcome } from "@/lib/db/types/settlementCrisis";
import {
  CARRY_THRESHOLD,
  LADDER_DECAY_TURNS,
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
 * Next turn's ladder heat, and the quiet-turn counter that governs decay.
 *
 * Coercive plays raise it but CANNOT cross to the armed rung: taking the bloc
 * to the brink is a deliberate act by an authority seat, not something that
 * accumulates.
 *
 * Decay is SLOWER THAN ACCUMULATION, and that asymmetry is the whole point. A
 * rung is lost only after `LADDER_DECAY_TURNS` consecutive turns with nothing
 * coercive, so holding a position costs coercion one turn in three rather than
 * every turn. Decaying on every quiet turn set a hidden 50% threshold — a bloc
 * had to act on more than half of all turns just to stand still — which no
 * bloc in the catalogue can sustain, so the ladder collapsed to zero and the
 * brink was unreachable rather than expensive. See the constant.
 *
 * `quietTurns` counts CONSECUTIVE ticks with nothing coercive. Any coercive
 * play resets it, and so does a rung actually being lost.
 */
export function nextHeat(params: { current: number; added: number; quietTurns?: number }): {
  heat: number;
  quietTurns: number;
} {
  const { current, added } = params;
  if (added > 0) {
    // An already-armed ladder stays armed while coercion continues; the
    // coercive cap must not drag it back down.
    const heat = current >= ARMED_RUNG ? current : Math.min(MAX_COERCIVE_RUNG, current + added);
    return { heat, quietTurns: 0 };
  }

  // `?? 0` and not a required field: a crisis written before the counter
  // existed reads as "no quiet turns yet", which costs it at most one turn of
  // grace it was never promised — the safe direction to err, since the other
  // one silently drops a live standoff.
  const quietTurns = (params.quietTurns ?? 0) + 1;
  if (quietTurns < LADDER_DECAY_TURNS) return { heat: current, quietTurns };
  // The counter restarts with the rung, so a long silence walks the ladder down
  // one step per grace rather than emptying it at once.
  return { heat: Math.max(0, current - 1), quietTurns: 0 };
}

export function defconFor(heat: number): number {
  return Math.max(1, Math.min(5, 6 - heat));
}

export function isArmed(heat: number): boolean {
  return heat >= ARMED_RUNG;
}
