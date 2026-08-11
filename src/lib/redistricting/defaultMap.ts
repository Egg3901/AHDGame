import type { DistrictSquares } from "@/lib/db/types/congressionalDistrict";
import { largestRemainderAllocate } from "./budget";

/** PVI magnitude that maps to a fully-packed district. R+30 ⇒ tilt +1. */
const PVI_FULL_SCALE = 30;

/** Deterministic FNV-1a hash of a string mapped into [0, 1). No RNG. */
export function hashStringToUnit(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Convert to unsigned and normalize.
  return (h >>> 0) / 0x100000000;
}

/** Positive PVI = Republican = right (+). Clamp to [-1, 1]. */
export function pviToTilt(pvi: number): number {
  const t = pvi / PVI_FULL_SCALE;
  return Math.max(-1, Math.min(1, t));
}

/**
 * Per-district tilt in [-1, 1] (negative = left, positive = right).
 * Uses cookPVI when any non-zero value is present; otherwise a deterministic
 * spread keyed by (stateId, index) so 1991/at-large/no-PVI states still vary.
 */
export function buildShapeTilts(
  stateId: string,
  n: number,
  pvis: (number | null)[] | null
): number[] {
  const hasPvi = Array.isArray(pvis) && pvis.length === n && pvis.some((p) => p != null && p !== 0);

  if (hasPvi) {
    return pvis!.map((p) => pviToTilt(p ?? 0));
  }

  // Deterministic spread: evenly fan tilts across [-1, 1] with per-district jitter.
  const tilts: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1 … +1
    const jitter = (hashStringToUnit(`${stateId}_${i + 1}`) - 0.5) * (2 / Math.max(1, n));
    tilts.push(Math.max(-1, Math.min(1, base + jitter)));
  }
  return tilts;
}

/**
 * Build per-district squares from a conserved budget and per-district tilts.
 * Left squares are allocated by a left-weight (high for left-tilted districts),
 * right squares by a right-weight; grey is the residual (16 − left − right),
 * which makes grey conserve automatically. A repair pass fixes any district
 * that would exceed 16 (negative grey).
 */
export function buildDefaultSquares(
  n: number,
  budget: DistrictSquares,
  tilts: number[]
): DistrictSquares[] {
  if (n === 1) {
    return [{ left: budget.left, right: budget.right, grey: budget.grey }];
  }

  const leftWeights = tilts.map((t) => Math.max(0, 0.5 - t / 2)); // t=-1 → 1, t=+1 → 0
  const rightWeights = tilts.map((t) => Math.max(0, 0.5 + t / 2)); // t=+1 → 1, t=-1 → 0

  const left = largestRemainderAllocate(budget.left, leftWeights);
  const right = largestRemainderAllocate(budget.right, rightWeights);

  // Repair: ensure left[i] + right[i] <= 16 by shifting the excess of the
  // smaller-weighted side to a district with spare capacity (same pool, so the
  // pool sum stays conserved).
  for (let i = 0; i < n; i++) {
    let overflow = left[i] + right[i] - 16;
    while (overflow > 0) {
      // Reduce the *larger* pool here — it always holds > 8 squares when the two
      // sum past 16, so it can never go negative. (Reducing by tilt-weight could
      // pick an empty pool and drive its count below zero, producing an invalid
      // district like {left:-15, right:31}.)
      const reduceRight = right[i] >= left[i];
      const arr = reduceRight ? right : left;
      // Find a recipient district with spare capacity in the same pool.
      let recipient = -1;
      for (let j = 0; j < n; j++) {
        if (j !== i && left[j] + right[j] < 16) {
          recipient = j;
          break;
        }
      }
      if (recipient === -1) break; // no capacity anywhere (should not happen for valid budgets)
      arr[i] -= 1;
      arr[recipient] += 1;
      overflow -= 1;
    }
  }

  return tilts.map((_t, i) => ({
    left: left[i],
    right: right[i],
    grey: 16 - left[i] - right[i],
  }));
}
