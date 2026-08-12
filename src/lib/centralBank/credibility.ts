import { corridorVerdict } from "@/lib/centralBank/rateCorridor";

/**
 * Central-bank credibility, derived from the existing scrutiny stock
 * (`CentralBank.chairInfamy`, 0-100).
 *
 * Scrutiny already rises when inflation misses target and growth undershoots,
 * already decays 5% a turn, and already takes a flat hit for an over-cap rate
 * cut and for a failed FX intervention. What it never did was touch the
 * economy: its only consequence was a personal tax on the chair's influence.
 *
 * These helpers give it that second job WITHOUT creating a death spiral. The
 * spiral would be: low credibility weakens policy, weak policy misses target,
 * missing target lowers credibility. Three properties break it.
 *
 *  1. The dampener is FLOORED and applies to ONE channel. A fully discredited
 *     bank still gets `TRANSMISSION_FLOOR` of the expectations effect, and loan
 *     rates, cost of capital and bond pricing are untouched. Policy always
 *     works; it just costs more to be believed.
 *  2. Scrutiny gain per turn is CAPPED, so one bad print cannot ruin a bank.
 *  3. Recovery is bought with RESOLVE, not results — see
 *     {@link resolveRecoveryDelta}. That is the escape hatch, and it is an
 *     action the player controls rather than an outcome they do not.
 */

/** Worst-case share of the expectations channel a discredited bank still gets. */
export const TRANSMISSION_FLOOR = 0.6;

/** Most scrutiny a bank can accumulate in a single turn. */
export const MAX_SCRUTINY_GAIN_PER_TURN = 8;

/** Consecutive turns a correct stance must be held before resolve pays out. */
export const RESOLVE_TURNS_REQUIRED = 3;

/** Scrutiny removed once a held, directionally correct stance matures. */
export const RESOLVE_SCRUTINY_RELIEF = 6;

/**
 * Share of scrutiny a NEW chair inherits. The institution keeps most of it, so
 * replacing the chair is not a credibility laundromat; the remainder is the
 * honeymoon that makes the job worth taking. Pairs with the interference
 * penalty: firing a chair costs the institution more than the reset saves.
 */
export const CHAIR_CHANGE_SCRUTINY_RETAINED = 0.75;

/** Scrutiny added to the INSTITUTION when the government overrides the bank. */
export const INTERFERENCE_SCRUTINY = 12;

/** 0 (no credibility) .. 1 (full credibility). */
export function credibilityFromScrutiny(scrutiny: number): number {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(scrutiny) ? scrutiny : 0));
  return 1 - clamped / 100;
}

/**
 * Multiplier on the INFLATION-EXPECTATIONS channel only. Never on loan rates,
 * cost of capital or bond pricing: a discredited bank must still be able to
 * cause a recession with a big enough move, otherwise policy becomes inert and
 * the player has no lever at all.
 */
export function transmissionMultiplier(scrutiny: number): number {
  return TRANSMISSION_FLOOR + (1 - TRANSMISSION_FLOOR) * credibilityFromScrutiny(scrutiny);
}

/** Cap the per-turn rise so ruin is earned over time and can be seen coming. */
export function capScrutinyGain(delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  return delta > MAX_SCRUTINY_GAIN_PER_TURN ? MAX_SCRUTINY_GAIN_PER_TURN : delta;
}

/**
 * Is the bank's current stance the one the corridor calls for?
 *
 * Above target inflation wants restrictive; below wants accommodative; inside
 * the band anything neutral counts. Uses the same `corridorVerdict` the UI
 * already shows, so what the player is told and what they are scored on cannot
 * drift apart.
 */
export function stanceIsCorrect(
  primeRate: number,
  inflation: number,
  targetInflation: number
): boolean {
  const { stance } = corridorVerdict(primeRate, inflation);
  if (inflation > targetInflation + 0.5) return stance === "restrictive";
  if (inflation < targetInflation - 0.5) return stance === "accommodative";
  return stance === "neutral";
}

export interface ResolveState {
  /** Consecutive turns the correct stance has been held, including this one. */
  resolveStreak: number;
  /** Scrutiny relief earned this turn (0 unless the streak just matured). */
  relief: number;
}

/**
 * Advance the resolve streak and pay out when it matures.
 *
 * Deliberately independent of whether inflation has actually responded: a chair
 * willing to hold an unpopular stance can ALWAYS climb out, which is what makes
 * the spiral escapable. The streak resets the moment the stance stops matching
 * the corridor, so the relief has to be re-earned.
 */
export function resolveRecoveryDelta(params: {
  correctStance: boolean;
  previousStreak: number;
}): ResolveState {
  if (!params.correctStance) return { resolveStreak: 0, relief: 0 };

  const streak = Math.max(0, params.previousStreak) + 1;
  if (streak < RESOLVE_TURNS_REQUIRED) return { resolveStreak: streak, relief: 0 };

  // Matured: pay out and restart the clock so relief is periodic, not per-turn.
  return { resolveStreak: 0, relief: RESOLVE_SCRUTINY_RELIEF };
}

/** Turns of held stance still owed before the next relief lands. */
export function turnsUntilResolveRelief(streak: number): number {
  return Math.max(0, RESOLVE_TURNS_REQUIRED - Math.max(0, streak));
}
