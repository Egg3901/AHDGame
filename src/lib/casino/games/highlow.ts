import { rollInt, type Rng } from "../rng";

/**
 * Higher or lower on a fresh card each step (A=1 .. K=13, drawn with
 * replacement). A tie loses. Each correct call multiplies the running return
 * by the fair price of that call less the edge, so every decision returns
 * (1 - edge) and cashing out early never beats pressing on in expectation.
 */
export const HIGHLOW_HOUSE_EDGE = 0.04;
export const HIGHLOW_MAX_STEPS = 10;
export type HighLowGuess = "higher" | "lower";

export function drawHighLowCard(rng: Rng): number {
  return rollInt(rng, 1, 13);
}

export function highLowWinChance(card: number, guess: HighLowGuess): number {
  return guess === "higher" ? (13 - card) / 13 : (card - 1) / 13;
}

/** Multiplier applied to the running return when `guess` from `card` is right. */
export function highLowStepMultiplier(card: number, guess: HighLowGuess): number {
  const chance = highLowWinChance(card, guess);
  if (chance <= 0) return 0;
  return Math.floor(((1 - HIGHLOW_HOUSE_EDGE) / chance) * 10_000) / 10_000;
}

export function resolveHighLowStep(
  card: number,
  next: number,
  guess: HighLowGuess
): { correct: boolean; stepMultiplier: number } {
  const correct = guess === "higher" ? next > card : next < card;
  return { correct, stepMultiplier: correct ? highLowStepMultiplier(card, guess) : 0 };
}
