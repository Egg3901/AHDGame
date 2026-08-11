import type { Crisis, CrisisEffect } from "@/lib/db/types/crisis";
import { CRISIS_FLAT_UNIT_SCALE, CRISIS_TICK_UNIT_SCALE } from "@/lib/crises/effectScale";

export type CrisisSeverity = "low" | "medium" | "high";

/**
 * A single effect's contribution to a crisis's overall severity, on a common
 * "impact" scale (roughly: points, where ~3 = a major one-off shock). Also drives
 * the per-effect strength bar in the UI so the bar and the severity badge agree.
 *
 * The previous severity calc summed only per-turn (`tick`) magnitudes, so almost
 * every crisis — whose big hits are one-time GDP/margin shocks — collapsed to the
 * lowest "Watch" tier. This weights every effect type:
 *   - gdpLoss     : a real fraction of GDP destroyed (0.03 → 3.0) — the heaviest.
 *   - tick        : recurs each turn, so a per-turn value is weighed up.
 *   - profitMargin: percentage-point margin shock (−10 → 1.2).
 *   - flat metric / approval / inflation: a one-off nudge, weighed modestly.
 *
 * `metric`/`approval`/`inflation` magnitudes are stored in native units (the
 * fractional authoring swing × the effectScale factor). We divide the tick/flat
 * weights by those same factors, so this classification is identical whatever the
 * scale constants are set to — the tiers track the authored swing, not the unit.
 * gdpLoss (a GDP fraction) and profitMargin (already in points) are not scaled.
 */
const TICK_WEIGHT = 8 / CRISIS_TICK_UNIT_SCALE;
const FLAT_WEIGHT = 3 / CRISIS_FLAT_UNIT_SCALE;

export function effectImpact(effect: CrisisEffect): number {
  const mag = Math.abs(effect.value);
  if (effect.targetType === "gdpLoss") return mag * 100;
  if (effect.targetType === "profitMargin") return mag * 0.12;
  if (effect.effectType === "tick") return mag * TICK_WEIGHT;
  // flat metric / approval / inflation
  return mag * FLAT_WEIGHT;
}

export const SEVERITY_HIGH_THRESHOLD = 3;
export const SEVERITY_MEDIUM_THRESHOLD = 1;

/**
 * Overall crisis severity, derived from the summed impact of ALL its effects
 * (not just per-turn ticks). Shared by the crises list and detail pages so the
 * two surfaces always agree.
 */
export function crisisSeverity(crisis: Pick<Crisis, "effects">): CrisisSeverity {
  const total = crisis.effects.reduce((sum, e) => sum + effectImpact(e), 0);
  if (total >= SEVERITY_HIGH_THRESHOLD) return "high";
  if (total >= SEVERITY_MEDIUM_THRESHOLD) return "medium";
  return "low";
}
