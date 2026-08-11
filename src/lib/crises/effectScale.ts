/**
 * Crisis effect unit scale — fraction → native metric units.
 *
 * Crisis templates author `metric`/`approval`/`inflation` effect magnitudes as
 * *fractional swings* (e.g. `-0.02` = "a 2% swing"). The game's metric, approval,
 * and inflation fields are all stored on **native point/percentage-point scales**
 * (gdpGrowth `1.5`, approvalRating `0–100`, inflationRate `2.5`), and the turn
 * engine applies effects as a raw `$inc` in those units (`crisisTurn.ts`,
 * `applyEffects.ts`). Without conversion a `-0.02` effect moves a percent-scale
 * metric by 0.02pp — effectively nothing. These constants convert the authored
 * swing into a native delta at construction time (in `fx()`), so the stored,
 * displayed, and applied values all agree.
 *
 * Two factors because the two effect kinds accumulate differently:
 *   - `flat`: applied once. ×100 turns a `-0.03` swing into a ~3-point one-off hit.
 *   - `tick`: applied every turn AND ramped down over the crisis (≈6.5× total across
 *     a 12-turn crisis, see `tickDecayFactor`), so it needs a smaller per-turn
 *     factor to land a comparable cumulative drag without flooring the metric.
 *
 * NOTE: `gdpLoss` (a genuine GDP fraction) and `profitMargin` (already authored in
 * percentage points) are NOT scaled — they bypass `fx()` via their own paths.
 *
 * Tuning the bite of every crisis is a single edit here. `severity.ts` divides its
 * impact weights by these same constants so its classification is scale-invariant.
 */
export const CRISIS_FLAT_UNIT_SCALE = 100;
export const CRISIS_TICK_UNIT_SCALE = 30;

/** Scale an authored fractional swing to a native metric delta for the given kind. */
export function toNativeEffectValue(effectType: "flat" | "tick", swing: number): number {
  return swing * (effectType === "tick" ? CRISIS_TICK_UNIT_SCALE : CRISIS_FLAT_UNIT_SCALE);
}
