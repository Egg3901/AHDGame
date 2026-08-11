import type { State } from "@/lib/db/types";

function weightsBy(seeds: State[], pick: (s: State) => number): Record<string, number> {
  const total = seeds.reduce((sum, s) => sum + pick(s), 0);
  const out: Record<string, number> = {};
  for (const s of seeds) out[s._id] = total > 0 ? pick(s) / total : 0;
  return out;
}

/** `_id` → population share (sums to 1). */
export const populationWeights = (seeds: State[]) => weightsBy(seeds, (s) => s.population);
/** `_id` → GDP share (sums to 1). */
export const gdpWeights = (seeds: State[]) => weightsBy(seeds, (s) => s.gdp ?? 0);

/**
 * Integer allocation of `total` across keys by weight, summing EXACTLY to `total`.
 * Floors each share, then hands the leftover units to the largest fractional
 * remainders (deterministic — ties break by the weights' key order).
 */
export function largestRemainderAllocate(
  total: number,
  weights: Record<string, number>
): Record<string, number> {
  const exact = Object.entries(weights).map(([k, w]) => ({ k, raw: total * w }));
  const out: Record<string, number> = {};
  let used = 0;
  for (const { k, raw } of exact) {
    out[k] = Math.floor(raw);
    used += out[k];
  }
  let remainder = total - used;
  const byFrac = [...exact].sort((a, b) => b.raw - Math.floor(b.raw) - (a.raw - Math.floor(a.raw)));
  for (let i = 0; i < byFrac.length && remainder > 0; i++, remainder--) out[byFrac[i].k] += 1;
  return out;
}

/** Scale each index of a count vector by `weight` (rounded). Non-conserving on its own. */
export const scaleCountVector = (vec: number[], weight: number): number[] =>
  vec.map((v) => Math.round(v * weight));

/**
 * Split a count vector across sub-regions so EACH index sums back to the
 * aggregate exactly (per-index largest-remainder). Returns `subId` → vector.
 */
export function splitCountVector(
  vec: number[],
  weights: Record<string, number>
): Record<string, number[]> {
  const ids = Object.keys(weights);
  const out: Record<string, number[]> = {};
  for (const id of ids) out[id] = new Array(vec.length).fill(0);
  for (let i = 0; i < vec.length; i++) {
    const alloc = largestRemainderAllocate(vec[i], weights);
    for (const id of ids) out[id][i] = alloc[id] ?? 0;
  }
  return out;
}

/**
 * Assign each item to a sub-region so each sub-region's Σqty ≈ its GDP share.
 * Greedy: process items by qty desc, place each in the sub-region currently
 * furthest (absolute) below its target Σqty. Deterministic.
 */
export function partitionByGdp<T>(
  items: T[],
  qty: (t: T) => number,
  seeds: State[]
): Record<string, T[]> {
  const weights = gdpWeights(seeds);
  const totalQty = items.reduce((s, it) => s + qty(it), 0);
  const target: Record<string, number> = {};
  const have: Record<string, number> = {};
  const buckets: Record<string, T[]> = {};
  for (const s of seeds) {
    target[s._id] = totalQty * (weights[s._id] ?? 0);
    have[s._id] = 0;
    buckets[s._id] = [];
  }
  const ordered = [...items].sort((a, b) => qty(b) - qty(a));
  for (const it of ordered) {
    let bestId = seeds[0]._id;
    let bestGap = -Infinity;
    for (const s of seeds) {
      const gap = target[s._id] - have[s._id];
      if (gap > bestGap) {
        bestGap = gap;
        bestId = s._id;
      }
    }
    buckets[bestId].push(it);
    have[bestId] += qty(it);
  }
  return buckets;
}
