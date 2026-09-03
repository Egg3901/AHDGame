/**
 * A tiny seeded generator for property-style tests. Deterministic, so a
 * failing sequence is reproducible from its seed, and dependency-free.
 * (Mulberry32: good enough distribution for command sequences, not for
 * anything cryptographic.)
 */
export interface SeededRandom {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  /** One element of a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** True with probability p. */
  chance(p: number): boolean;
  /** A money amount with two decimals in [min, max]. */
  money(min: number, max: number): number;
}

export function seededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    money: (min, max) => Math.round((min + next() * (max - min)) * 100) / 100,
  };
}

/** Run `body` for `count` seeds starting at `start`; the seed is in the failure. */
export function forSeeds(
  count: number,
  body: (random: SeededRandom, seed: number) => void,
  start = 1
): void {
  for (let seed = start; seed < start + count; seed += 1) {
    try {
      body(seededRandom(seed), seed);
    } catch (error) {
      if (error instanceof Error) error.message = `[seed ${seed}] ${error.message}`;
      throw error;
    }
  }
}
