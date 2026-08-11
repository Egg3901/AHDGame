/**
 * Apply diminishing returns based on current modifier.
 * As modifier approaches +/-20%, effectiveness decreases linearly.
 *
 * @param currentModifier - Current turnout modifier (-20 to +20)
 * @param boost - Calculated boost amount
 * @returns Adjusted boost with diminishing returns applied
 */
export function applyDiminishingReturns(currentModifier: number, boost: number): number {
  const MAX_MODIFIER = 20;
  const diminishingFactor = 1.0 - Math.abs(currentModifier) / MAX_MODIFIER;
  return boost * Math.max(0, diminishingFactor);
}
