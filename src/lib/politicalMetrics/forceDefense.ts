import type { ForceAggregate } from "@/lib/constants/military";
import { FORCE_EFFECT } from "@/lib/constants/military";

/**
 * The military FORCE effect's direct contribution to the four hard-power `defense`
 * political families (the political-pipeline countries only). Computed from the force
 * aggregate the effect already has; merged into the political contribution snapshot
 * alongside the mapped cabinet deltas, then folded/decayed like any residual driver.
 *
 * Values are already in political-point/turn space (NOT run through the cabinet GAIN).
 * Spec: docs/superpowers/specs/2026-07-23-military-defense-political-drivers-design.md
 */

/** Per-family scale (playtest-tunable): ~0.3 → a baseline force ≈ 3-point steady-state. */
export const DEFENSE_W = {
  armedForces: 0.3,
  security: 0.3,
  projection: 0.3,
  defenseIndustry: 0.3,
} as const;

/**
 * `burden` is the force measured against the country's own seeded order of battle — how
 * large a military the nation carries relative to what it was built to carry, which is the
 * closest available proxy for what `defense.defenseIndustry` is asking. It does NOT vary
 * with the defence line; see `upkeepBurden`.
 *
 * ⚠️ `burden` is nullable ON PURPOSE and null is NOT interchangeable with 0. A burden of 0
 * means the force costs nothing to sustain, which is the most POSITIVE reading available;
 * null means the country has no usable defence line and the metric has nothing to say.
 * Collapsing the two — by narrowing this to `number` and letting callers pass 0 — hands every
 * unfunded country a maximal score. `militaryForceEffects.test.ts` pins the difference.
 */
export function forceDefenseContribution(
  agg: ForceAggregate,
  burden: number | null,
  avgTechTier: number
): Record<string, number> {
  const powerSig = Math.min(1.5, agg.totalPower / FORCE_EFFECT.POWER_NORM);
  const readySig = (agg.avgReadiness - 60) / 40; // centered at 60, +1 at 100
  const projSig = agg.forwardShare;
  const spendSig = burden == null ? 0 : Math.min(1, burden);
  const modernSig = avgTechTier / 3; // tiers 0..3

  const raw: Record<string, number> = {
    "defense.armedForces": powerSig * DEFENSE_W.armedForces,
    "defense.security": (0.5 * readySig + 0.5 * powerSig) * DEFENSE_W.security,
    "defense.projection": projSig * DEFENSE_W.projection,
    "defense.defenseIndustry": (0.5 * spendSig + 0.5 * modernSig) * DEFENSE_W.defenseIndustry,
  };

  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(raw)) {
    const r = +v.toFixed(4);
    if (Math.abs(r) >= 0.0001) out[id] = r;
  }
  return out;
}
