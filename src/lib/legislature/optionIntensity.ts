// effectDirection is optional here so callers can pass PolicyOptionLite (whose
// effectDirection is optional). A missing value is treated as 0 (center/no push).
export type IntensityOption = { effectDirection?: number };

/** Index of the ladder's center (effectDirection === 0 / missing), else the geometric midpoint. */
export function ladderCenterIndex(options: IntensityOption[]): number {
  const i = options.findIndex((o) => (o.effectDirection ?? 0) === 0);
  return i >= 0 ? i : (options.length - 1) / 2;
}

/**
 * Signed intensity of an option on its ladder, in [-1, +1].
 * sign = the option's effectDirection (which end is the "positive" push);
 * magnitude = normalized distance from the center option.
 * Center (ed === 0) → exactly 0. Pure function of ladder shape — no re-authoring.
 */
/**
 * The effectDirection of the option at `index`, ladder-shape aware. Falls back
 * to the legacy 7-option center-3 convention ONLY when no ladder is available —
 * new-generation 5-level ladders (center 2) must never hit the fallback
 * (political-legislation spec §10 option-count sweep).
 */
export function effectDirectionAtIndex(
  options: IntensityOption[] | undefined,
  index: number
): number {
  const option = options?.[index];
  if (option && typeof option.effectDirection === "number") {
    return Math.sign(option.effectDirection);
  }
  return index < 3 ? -1 : index > 3 ? 1 : 0;
}

export function optionIntensity(options: IntensityOption[], index: number): number {
  if (!options.length || index < 0 || index >= options.length) return 0;
  const c = ladderCenterIndex(options);
  const maxDist = Math.max(c, options.length - 1 - c) || 1;
  const magnitude = Math.abs(index - c) / maxDist;
  const sign = Math.sign(options[index].effectDirection ?? 0);
  return sign * magnitude;
}

/** True when effectDirection is monotone (non-increasing or non-decreasing) across the ladder. */
export function isMonotoneLadder(options: IntensityOption[]): boolean {
  let nonInc = true;
  let nonDec = true;
  for (let i = 1; i < options.length; i++) {
    const d = (options[i].effectDirection ?? 0) - (options[i - 1].effectDirection ?? 0);
    if (d > 0) nonInc = false;
    if (d < 0) nonDec = false;
  }
  return nonInc || nonDec;
}
