/**
 * Deterministic RNG for turn replay — never use Math.random() in turn paths.
 */
import { createHash } from "crypto";

export function hashToUint32(input: string): number {
  return createHash("sha256").update(input).digest().readUInt32BE(0);
}

/** Returns an integer in [1, 100] for the given seed components. */
export function seededRoll(scopeId: string, turn: number, kind: string, salt: string): number {
  const seed = hashToUint32(`${scopeId}:${turn}:${kind}:${salt}`);
  return (seed % 100) + 1;
}

/** Weighted pick from items using a precomputed offer roll in [1, 100]. */
export function pickWeightedIndex<T extends { weight: number }>(
  items: T[],
  offerRoll: number
): number {
  if (items.length === 0) {
    throw new Error("pickWeightedIndex: empty items");
  }
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    throw new Error("pickWeightedIndex: total weight must be positive");
  }
  const target = ((offerRoll - 1) / 100) * totalWeight;
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += items[i].weight;
    if (target < cumulative) {
      return i;
    }
  }
  return items.length - 1;
}

/**
 * Build a deterministic [0, 1) sequence from a seed — a replay-safe stand-in for
 * Math.random in turn paths. Each call advances an internal counter.
 */
export function makeSeededRng(seed: string): () => number {
  let counter = 0;
  return () => {
    const n = hashToUint32(`${seed}:${counter++}`);
    return n / 0x1_0000_0000;
  };
}

/** Cooldown spacing roll in [min, max] inclusive. */
export function seededCooldownTurns(
  scopeId: string,
  turn: number,
  min: number,
  max: number
): number {
  if (min > max) {
    throw new Error("seededCooldownTurns: min cannot exceed max");
  }
  const span = max - min + 1;
  const seed = hashToUint32(`${scopeId}:${turn}:cooldown`);
  return min + (seed % span);
}
