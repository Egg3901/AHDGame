import { randomInt } from "node:crypto";

/** Uniform draw in [0, 1). Games take it as a parameter so tests can pin outcomes. */
export type Rng = () => number;

/** `randomInt` requires max - min below 2^48. */
const RNG_SPAN = 2 ** 48 - 1;

/** Cryptographic RNG. The bot never decides an outcome, so the draw must not be predictable. */
export const cryptoRng: Rng = () => randomInt(0, RNG_SPAN) / RNG_SPAN;

/** Integer in [min, max] inclusive. */
export function rollInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Pick one entry, weighted. Weights must be positive. */
export function pickWeighted<T>(rng: Rng, items: readonly { value: T; weight: number }[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll < 0) return item.value;
  }
  return items[items.length - 1].value;
}
