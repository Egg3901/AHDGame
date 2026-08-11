/**
 * Display helpers for the CEO-adjustable sector production level
 * (`corporateSectors.productionPolicyLevel`, −25…+25, trends toward the CEO-set
 * `productionPolicy` at 1/turn).
 */

export const PRODUCTION_LEVEL_MIN = -25;
export const PRODUCTION_LEVEL_MAX = 25;

export type ProductionTone = "success" | "error" | "neutral";

/**
 * Positive output levels read as success, negative as error — the same
 * encoding the CEO production surface (`CeoProductionSubtab`) already uses.
 * Negative levels also accrue the sustained-negative-production margin
 * penalty (`getSustainedNegativeProductionPenalty`). Never color-only — the
 * signed value always accompanies the tone.
 */
export function productionTone(level: number): ProductionTone {
  if (level < 0) return "error";
  if (level > 0) return "success";
  return "neutral";
}

/** Signed output-level display, percent denominated: "+12%", "0%", "-12%". */
export function formatProductionLevel(level: number): string {
  return level > 0 ? `+${level}%` : `${level}%`;
}

/** Fill fraction (0–100) of the −25…+25 range, for the mini level bar. */
export function productionFillPercent(level: number): number {
  const clamped = Math.max(PRODUCTION_LEVEL_MIN, Math.min(PRODUCTION_LEVEL_MAX, level));
  return ((clamped - PRODUCTION_LEVEL_MIN) / (PRODUCTION_LEVEL_MAX - PRODUCTION_LEVEL_MIN)) * 100;
}
