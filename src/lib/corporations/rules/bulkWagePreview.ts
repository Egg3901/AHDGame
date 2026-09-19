/**
 * Bulk wage previews hold production and existing labour modifiers constant.
 * estimateWageChange respects negotiated wage floors and reports missing cost data.
 */
import { clampWageLevel } from "@/lib/labour/laborCost";
export function estimateWageChange(
  currentCost: number | undefined,
  currentWage: number | undefined,
  target: number,
  floor: number
) {
  if (currentCost == null || !Number.isFinite(currentCost) || currentCost < 0) return null;
  const before = Math.max(clampWageLevel(currentWage ?? 1), floor);
  const after = Math.max(clampWageLevel(target), floor);
  return { current: currentCost, projected: (currentCost * after) / before };
}
