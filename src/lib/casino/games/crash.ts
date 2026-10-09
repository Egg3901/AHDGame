import type { Rng } from "../rng";

/**
 * Crash with an automatic cash-out. The player names a target before the
 * round; the server draws the crash point and the target either survives it
 * or not. A live cash-out button would let whoever presses it pick the result
 * after seeing the curve, so the bot only animates the outcome.
 *
 * The crash point is (1 - edge) / (1 - u), so P(crash >= t) = (1 - edge) / t
 * and every target returns (1 - edge) of the stake.
 */
export const CRASH_HOUSE_EDGE = 0.04;
export const CRASH_MIN_TARGET = 1.01;
export const CRASH_MAX_TARGET = 100;

export interface CrashRound {
  crashPoint: number;
  target: number;
  won: boolean;
  multiplier: number;
}

export function drawCrashPoint(rng: Rng): number {
  const raw = (1 - CRASH_HOUSE_EDGE) / (1 - rng());
  return Math.max(1, Math.floor(raw * 100) / 100);
}

export function playCrash(rng: Rng, target: number): CrashRound {
  const crashPoint = drawCrashPoint(rng);
  const won = crashPoint >= target;
  return { crashPoint, target, won, multiplier: won ? target : 0 };
}
