import type { CrisisEffect } from "@/lib/db/types/crisis";
import { toNativeEffectValue } from "@/lib/crises/effectScale";

/**
 * Compact effect builder for living-conflict definitions. Mirrors the crisis
 * templates' `fx`: author swings as fractions (-0.02 = a 2% swing) and the
 * builder scales them to native metric units. Inflation routes to its dedicated
 * national target, matching the crisis engine.
 */
export function cfx(
  effectType: "flat" | "tick",
  targetType: "metric" | "approval" | "profitMargin",
  metricCategory: string,
  metricField: string,
  swing: number,
  label: string
): CrisisEffect {
  const value = toNativeEffectValue(effectType, swing);
  if (targetType === "metric" && metricCategory === "economy" && metricField === "inflation") {
    return {
      effectType,
      targetType: "inflation",
      metricCategory: null,
      metricField: null,
      value,
      sectorType: null,
      strategyId: null,
      label,
    };
  }
  return {
    effectType,
    targetType,
    metricCategory: targetType === "metric" ? metricCategory : null,
    metricField: targetType === "metric" ? metricField : null,
    value,
    sectorType: null,
    strategyId: null,
    label,
  };
}
