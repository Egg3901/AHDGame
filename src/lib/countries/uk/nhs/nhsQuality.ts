/**
 * UK NHS service-quality model (epic #856, ticket #858 — Cluster B).
 *
 * A running quality score in [0, 100] driven by funding vs demand. It moves
 * GRADUALLY (a collapsed NHS takes time to rebuild; a well-funded one takes time
 * to show), and its state feeds two things:
 *   - a dynamic salience multiplier: a failing NHS becomes THE election issue,
 *     amplifying NHS pledges (Cluster A);
 *   - an approval modifier on the governing party.
 *
 * Closes the Budget → service → approval → election loop. Pure and decoupled:
 * the caller supplies a funding ratio (health spend vs demand). Magnitudes are
 * first-pass; calibrate in worldsim. See ops-knowledge `uk-rework-design-2026-08-25`.
 */

export const NHS_QUALITY_MIN = 0;
export const NHS_QUALITY_MAX = 100;

/** Starting NHS quality for a world with no history. */
export const NHS_QUALITY_START = 60;

/**
 * Healthcare share of the Budget (percent) that is treated as exactly meeting
 * demand (funding ratio 1.0). Fund the NHS above this in the Budget and quality
 * climbs; below it and quality falls. First-pass; calibrate in worldsim.
 */
export const NHS_BASELINE_HEALTHCARE_SHARE = 18;

/** Funding ratio implied by the Budget's healthcare spending share. */
export function fundingRatioFromHealthcareShare(healthcareSharePct: number): number {
  if (NHS_BASELINE_HEALTHCARE_SHARE <= 0) return 1;
  return Math.max(0, healthcareSharePct) / NHS_BASELINE_HEALTHCARE_SHARE;
}

/** Max quality change per turn — the gradual-movement (hysteresis) knob. */
export const NHS_QUALITY_MAX_STEP = 6;

/** Funding ratio (1.0 = funding exactly meets demand) that maps to this target quality. */
export const NHS_TARGET_AT_PARITY = 70;
/** Quality target ceiling for generous funding. */
export const NHS_TARGET_MAX = 100;

/**
 * Target quality for a given funding ratio (health funding / demand).
 *  - ratio 0   → 0
 *  - ratio 1.0 → NHS_TARGET_AT_PARITY
 *  - ratio >1  → rises toward NHS_TARGET_MAX, saturating.
 */
export function nhsTargetQuality(fundingRatio: number): number {
  const r = Math.max(0, fundingRatio);
  if (r <= 1) return clampQuality(r * NHS_TARGET_AT_PARITY);
  // Above parity, close the remaining gap to the ceiling, saturating.
  const headroom = NHS_TARGET_MAX - NHS_TARGET_AT_PARITY;
  const closed = 1 - Math.exp(-(r - 1)); // 0 at r=1, → 1 as r grows
  return clampQuality(NHS_TARGET_AT_PARITY + headroom * closed);
}

/** Move current quality toward the target for this funding ratio, capped per turn. */
export function tickNhsQuality(currentQuality: number, fundingRatio: number): number {
  const target = nhsTargetQuality(fundingRatio);
  const delta = target - currentQuality;
  const step = Math.max(-NHS_QUALITY_MAX_STEP, Math.min(NHS_QUALITY_MAX_STEP, delta));
  return clampQuality(currentQuality + step);
}

/** How much low quality amplifies NHS salience at its worst (quality 0). */
export const NHS_SALIENCE_AMP = 1;

/**
 * Salience multiplier for NHS pledges given current quality.
 *  - quality 100 → 1.0 (baseline importance)
 *  - quality 0   → 1 + NHS_SALIENCE_AMP (a failing NHS dominates the election)
 */
export function nhsSalienceMultiplier(quality: number): number {
  const q = clampQuality(quality);
  return 1 + (1 - q / NHS_QUALITY_MAX) * NHS_SALIENCE_AMP;
}

/** Approval swing at the extremes (quality 0 or 100). */
export const NHS_APPROVAL_SWING = 10;

/**
 * Approval modifier from NHS quality, centred at quality 50.
 *  - quality 100 → +NHS_APPROVAL_SWING
 *  - quality 50  → 0
 *  - quality 0   → -NHS_APPROVAL_SWING
 */
export function nhsApprovalModifier(quality: number): number {
  const q = clampQuality(quality);
  return ((q - 50) / 50) * NHS_APPROVAL_SWING;
}

function clampQuality(v: number): number {
  return Math.max(NHS_QUALITY_MIN, Math.min(NHS_QUALITY_MAX, v));
}
