import type { DistrictSquares } from "@/lib/db/types/congressionalDistrict";
import type { PoolPercents } from "./pools";

/**
 * Allocate `total` indivisible units across buckets in proportion to `weights`,
 * using the largest-remainder (Hare) method. Result is non-negative integers
 * summing exactly to `total`. Zero/empty weights spread as evenly as possible.
 */
export function largestRemainderAllocate(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (total <= 0) return new Array(n).fill(0);

  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  const even = sum <= 0;
  const exact = weights.map((w) => (even ? total / n : (total * Math.max(0, w)) / sum));
  const floors = exact.map((x) => Math.floor(x));
  const used = floors.reduce((a, b) => a + b, 0);
  let remaining = total - used;

  // Distribute leftover units to the largest fractional remainders (ties: lower index).
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floors];
  let k = 0;
  while (remaining > 0) {
    result[order[k % n].i] += 1;
    remaining -= 1;
    k += 1;
  }
  return result;
}

/**
 * Convert pool percentages into a conserved 16·n square budget.
 * Left/right are rounded; grey takes the residual so the total is exactly 16·n.
 * If rounding makes grey negative, trim from the larger of left/right.
 */
export function computeSquareBudget(pct: PoolPercents, n: number): DistrictSquares {
  const total = 16 * n;
  let left = Math.round((pct.left / 100) * total);
  let right = Math.round((pct.right / 100) * total);
  let grey = total - left - right;

  if (grey < 0) {
    let deficit = -grey;
    // Trim the larger pool first.
    while (deficit > 0) {
      if (left >= right && left > 0) left -= 1;
      else if (right > 0) right -= 1;
      else break;
      deficit -= 1;
    }
    grey = total - left - right;
  }

  // Guarantee a minimal two-party presence so rounding can never zero out a side
  // and leave a state monochromatic-grey. Borrow from grey first, else the larger
  // pool. Only meaningful when there are at least two squares to split.
  if (total >= 2) {
    if (left < 1) {
      if (grey > 0) grey -= 1;
      else right -= 1;
      left += 1;
    }
    if (right < 1) {
      if (grey > 0) grey -= 1;
      else left -= 1;
      right += 1;
    }
  }

  return { left, right, grey };
}
