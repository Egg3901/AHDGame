import type { DistrictSquares } from "@/lib/db/types/congressionalDistrict";
import type { RedistrictCaps } from "./caps";

/** A district is "packed" when one pool holds at least this many of its 16 squares. */
export const PACKED_THRESHOLD = 12;

/**
 * Two-party efficiency gap on the left/right squares: |wastedRight − wastedLeft|
 * over total two-party squares. Wasted = losing-side squares + winning-side
 * squares beyond the (half+1) needed. Grey is excluded (it is the swing).
 */
export function computeEfficiencyGap(districts: DistrictSquares[]): number {
  let wastedLeft = 0;
  let wastedRight = 0;
  let totalTwoParty = 0;
  for (const d of districts) {
    const twoParty = d.left + d.right;
    if (twoParty <= 0) continue;
    totalTwoParty += twoParty;
    const needed = Math.floor(twoParty / 2) + 1;
    if (d.left >= d.right) {
      wastedLeft += Math.max(0, d.left - needed);
      wastedRight += d.right;
    } else {
      wastedRight += Math.max(0, d.right - needed);
      wastedLeft += d.left;
    }
  }
  if (totalTwoParty <= 0) return 0;
  return Math.abs(wastedRight - wastedLeft) / totalTwoParty;
}

export function validateRedistrictMap(
  proposed: DistrictSquares[],
  budget: DistrictSquares,
  caps: RedistrictCaps
): { legal: boolean; violations: string[] } {
  const violations: string[] = [];

  if (!caps.canDraw) {
    violations.push("Map is commission-drawn; the legislature cannot redraw it.");
    return { legal: false, violations };
  }

  const n = proposed.length;
  // Per-district integrity.
  for (let i = 0; i < n; i++) {
    const d = proposed[i];
    if (d.left < 0 || d.right < 0 || d.grey < 0)
      violations.push(`District ${i + 1} has a negative square count.`);
    if (d.left + d.right + d.grey !== 16)
      violations.push(`District ${i + 1} does not total 16 squares.`);
  }

  // Conservation: totals must equal the budget exactly.
  const sum = proposed.reduce(
    (acc, d) => ({ left: acc.left + d.left, right: acc.right + d.right, grey: acc.grey + d.grey }),
    { left: 0, right: 0, grey: 0 }
  );
  if (sum.left !== budget.left || sum.right !== budget.right || sum.grey !== budget.grey) {
    violations.push(
      `Map does not conserve the state's voters (have L${sum.left}/R${sum.right}/G${sum.grey}, need L${budget.left}/R${budget.right}/G${budget.grey}).`
    );
  }

  // Per-district deviation from the state mean lean.
  const meanNetLean = n > 0 ? (budget.right - budget.left) / n : 0;
  for (let i = 0; i < n; i++) {
    const netLean = proposed[i].right - proposed[i].left;
    if (Math.abs(netLean - meanNetLean) > caps.maxDistrictDeviation + 1e-9) {
      violations.push(
        `District ${i + 1} deviates ${Math.abs(netLean - meanNetLean).toFixed(1)} from the state mean (max ${caps.maxDistrictDeviation}).`
      );
    }
  }

  // Packed-district count.
  const packed = proposed.filter(
    (d) => d.left >= PACKED_THRESHOLD || d.right >= PACKED_THRESHOLD || d.grey >= PACKED_THRESHOLD
  ).length;
  if (packed > caps.maxPackedDistricts) {
    violations.push(`${packed} packed districts exceed the limit of ${caps.maxPackedDistricts}.`);
  }

  // Statewide efficiency gap.
  const eg = computeEfficiencyGap(proposed);
  if (eg > caps.efficiencyGapCeiling + 1e-9) {
    violations.push(
      `Efficiency gap ${(eg * 100).toFixed(1)}% exceeds the fairness ceiling ${(caps.efficiencyGapCeiling * 100).toFixed(0)}%.`
    );
  }

  return { legal: violations.length === 0, violations };
}
