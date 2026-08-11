/**
 * Per-domain stance derivation for NPPs.
 *
 * The cross-pressure resolver expects `npp.policies.domainPositions[legislationTypeId]`
 * on a -5..+5 scale (positive = supports the legislation type's leftward direction,
 * negative = supports the rightward direction). The NPP generator only writes
 * `economic` and `social` (also -5..+5); this module derives a per-legislation-type
 * stance by aligning the NPP's position with each legislation type's encoded axis.
 *
 * Each `LegislationPolicyOption` has `economic` and `social` scores that encode
 * the option's left/right position on those axes. We average those scores across
 * the type's explicit left-stance options to get a "leftward axis
 * vector"; the dot product with the NPP's (economic, social) gives a stance whose
 * sign matches the NPP's alignment with that direction.
 */

import type { LegislationType } from "@/lib/db/types";

/** Random integer-friendly number in [min, max). Pure interface so callers can inject seeds. */
type RandomFn = () => number;

const DEFAULT_NOISE = 1.0; // ±1 stance jitter so same-party NPPs differ

function clampStance(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n > 5) return 5;
  if (n < -5) return -5;
  return n;
}

/**
 * Compute the leftward axis vector from a legislation type's policy options.
 * Returns null if the type has no useful axis (no options, no left options, or
 * all options have zero economic/social scores).
 */
function leftwardAxisFor(
  type: LegislationType
): { econ: number; social: number; magnitude: number } | null {
  const options = type.policyOptions ?? [];
  if (options.length === 0) return null;

  const leftOpts = options.filter((o) => o.stance === "left");
  if (leftOpts.length === 0) return null;

  let econSum = 0;
  let socSum = 0;
  for (const o of leftOpts) {
    econSum += o.economic ?? 0;
    socSum += o.social ?? 0;
  }
  const econ = econSum / leftOpts.length;
  const social = socSum / leftOpts.length;
  const magnitude = Math.hypot(econ, social);
  if (magnitude === 0) return null;

  return { econ, social, magnitude };
}

/**
 * Derive an NPP's stance toward a single legislation type's leftward direction.
 * Returns undefined when the legislation type carries no usable axis encoding.
 *
 * Math: dot product of (economic, social) with the type's leftward-axis unit
 * vector × 5/√2 — chosen so an NPP perfectly aligned with the type's axis at
 * (±5, ±5) lands at ±5 (clamped) and a partially aligned NPP at e.g. (-3, 0)
 * on a pure-economic axis lands at +3.
 */
export function deriveDomainStance(
  type: LegislationType,
  economic: number, // -5..+5
  social: number, // -5..+5
  rng: RandomFn = Math.random,
  noise: number = DEFAULT_NOISE
): number | undefined {
  const axis = leftwardAxisFor(type);
  if (!axis) return undefined;

  // Normalize axis to unit vector, then dot with NPP position.
  const dot = (economic * axis.econ + social * axis.social) / axis.magnitude;
  // Negate: leftward axis components are typically negative (e.g. avgLeftEcon ≈ -3),
  // so a left-aligned NPP (negative economic) produces a positive dot. That's
  // already the correct sign for "supports leftward direction" (positive stance).
  // The above dot already has the right sign since:
  //   economic = -5 (left), axis.econ = -3 → dot = +5 → positive stance ✓
  //   economic = +5 (right), axis.econ = -3 → dot = -5 → negative stance ✓
  const jitter = (rng() * 2 - 1) * noise;
  return clampStance(dot + jitter);
}

/**
 * Build the full `domainPositions` map for an NPP across all provided
 * legislation types. Skips types with no usable axis encoding.
 */
export function deriveDomainPositions(
  legislationTypes: LegislationType[],
  economic: number,
  social: number,
  rng: RandomFn = Math.random,
  noise: number = DEFAULT_NOISE
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const type of legislationTypes) {
    const stance = deriveDomainStance(type, economic, social, rng, noise);
    if (typeof stance === "number") {
      out[type._id] = Math.round(stance * 10) / 10; // 1-decimal precision matches policies.economic/social
    }
  }
  return out;
}
