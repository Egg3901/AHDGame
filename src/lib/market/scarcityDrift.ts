/**
 * Scarcity drift — persistent-imbalance price integrator (clearing+capital
 * week-1 balance pass, t900; see /reports/clearing-capital-live-t899).
 *
 * `computeMarketPrice` is memoryless: price is a LEVEL function of the
 * current supply/demand ratio, so a chronic shortage produces a constant
 * elevated price rather than a rising one. Three turns into full clearing,
 * 47% of global demand went unmet every turn while no commodity price moved
 * more than ~2% — the price signal the whole behavioural layer (posture
 * choices, cartels, re-strategizing into scarce resources) depends on was
 * flat.
 *
 * The drift multiplier gives prices memory. Per commodity, per turn the
 * multiplier takes one small clamped step toward an imbalance-proportional
 * TARGET:
 *   - unmet share  > threshold → step UP toward a target scaled by how far the
 *     shortage exceeds the threshold (severe shortage → cap; mild → mid-range)
 *   - surplus share > threshold → step DOWN toward a target scaled the same way
 *   - otherwise → multiplier decays geometrically back toward 1
 *
 * The multiplier scales the commodity's base price before the usual level
 * formula, so global/national/state legs all inherit it consistently and
 * price-realization ratios (price/base) rise with it — which is exactly the
 * revenue incentive that makes a scarce resource worth mining without
 * forcing anyone's hand.
 *
 * Steps are small and clamped (±0.4%/turn) — this is the increment-based
 * movement the gameplay-advisors channel asked for, not free-fall repricing.
 *
 * The severity-scaled target is the fix for the "structural margin vise"
 * (#3297): the original ratchet marched to the hard cap for ANY imbalance
 * above the 15% threshold, so a 16% shortage and a 90% shortage both railed at
 * 2.5×. Over ~200 turns every persistently-imbalanced commodity pinned at its
 * extreme (inputs at 2.5×, service outputs at 0.6×) with no middle ground,
 * crushing corp margins from both sides. Anchoring the step to a target that
 * grows with imbalance severity means only genuinely severe scarcity/glut
 * reaches the cap; moderate imbalance settles at a proportional mid-range and a
 * commodity whose imbalance eases drifts back down off the rail. The step
 * formulas (prev·(1+step) / prev÷(1+step)) are unchanged — only their
 * destination moved from the cap to the target — so tested edge behaviour
 * (severe imbalance still reaches the cap, dead band still decays) is preserved.
 */

/** Unmet-demand share (of demand) above which prices ratchet up. */
export const SCARCITY_DRIFT_UNMET_THRESHOLD = 0.15;
/** Surplus share (of supply) above which prices ratchet down. */
export const SCARCITY_DRIFT_SURPLUS_THRESHOLD = 0.15;
/** Per-turn ratchet step while an imbalance persists. */
export const SCARCITY_DRIFT_STEP = 0.004;
/** Geometric decay toward 1 per balanced turn (~34 turns to halve). */
export const SCARCITY_DRIFT_DECAY = 0.98;
/** Hard bounds on the multiplier. */
export const SCARCITY_DRIFT_MAX = 2.5;
export const SCARCITY_DRIFT_MIN = 0.6;
/**
 * Unmet share at (and above) which the up-target reaches SCARCITY_DRIFT_MAX.
 * Between the ratchet threshold and this, the target scales linearly, so mild
 * shortages settle at a proportional mid-range instead of railing at the cap.
 */
export const SCARCITY_DRIFT_SEVERE_UNMET = 0.45;
/** Surplus share at (and above) which the down-target reaches SCARCITY_DRIFT_MIN. */
export const SCARCITY_DRIFT_SEVERE_SURPLUS = 0.45;

/**
 * Fraction (0..1) of the way from the ratchet threshold to the "severe" point.
 * `share` at/below `threshold` → 0; at/above `severe` → 1; linear between.
 */
function severityFraction(share: number, threshold: number, severe: number): number {
  if (!(severe > threshold)) return share > threshold ? 1 : 0;
  return Math.max(0, Math.min(1, (share - threshold) / (severe - threshold)));
}

function clampMultiplier(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(SCARCITY_DRIFT_MIN, Math.min(SCARCITY_DRIFT_MAX, value));
}

/**
 * Advance one commodity's scarcity multiplier by one turn.
 * Pure; both units are the CURRENT turn's aggregate supply/demand.
 */
export function updateScarcityMultiplier(
  previous: number | null | undefined,
  supplyUnits: number,
  demandUnits: number
): number {
  const prev = clampMultiplier(previous ?? 1);
  const supply = Number.isFinite(supplyUnits) ? Math.max(0, supplyUnits) : 0;
  const demand = Number.isFinite(demandUnits) ? Math.max(0, demandUnits) : 0;

  // No market at all — hold position, decaying toward neutral.
  if (supply <= 0 && demand <= 0) return decayToward1(prev);

  const unmetShare = demand > 0 ? Math.max(0, demand - supply) / demand : 0;
  const surplusShare = supply > 0 ? Math.max(0, supply - demand) / supply : 0;

  if (unmetShare > SCARCITY_DRIFT_UNMET_THRESHOLD) {
    // Target scales with shortage severity: mild shortage → mid-range, severe → cap.
    const target =
      1 +
      (SCARCITY_DRIFT_MAX - 1) *
        severityFraction(unmetShare, SCARCITY_DRIFT_UNMET_THRESHOLD, SCARCITY_DRIFT_SEVERE_UNMET);
    return stepToward(prev, target);
  }
  if (surplusShare > SCARCITY_DRIFT_SURPLUS_THRESHOLD) {
    // Target scales with glut severity: mild surplus → mid-range, severe → floor.
    const target =
      1 -
      (1 - SCARCITY_DRIFT_MIN) *
        severityFraction(
          surplusShare,
          SCARCITY_DRIFT_SURPLUS_THRESHOLD,
          SCARCITY_DRIFT_SEVERE_SURPLUS
        );
    return stepToward(prev, target);
  }
  return decayToward1(prev);
}

/**
 * Move `prev` one clamped step toward `target`, reusing the original ratchet
 * step size (prev·(1+STEP) up, prev÷(1+STEP) down) but stopping at the target
 * rather than overshooting toward the hard cap. When prev is already past the
 * target (e.g. a commodity railed at 2.5 whose shortage has since eased) it
 * steps back the other way — this is what de-pins a stuck multiplier.
 */
function stepToward(prev: number, target: number): number {
  const clampedTarget = clampMultiplier(target);
  if (prev < clampedTarget) {
    return clampMultiplier(Math.min(clampedTarget, prev * (1 + SCARCITY_DRIFT_STEP)));
  }
  if (prev > clampedTarget) {
    return clampMultiplier(Math.max(clampedTarget, prev / (1 + SCARCITY_DRIFT_STEP)));
  }
  return clampMultiplier(prev);
}

function decayToward1(prev: number): number {
  const next = 1 + (prev - 1) * SCARCITY_DRIFT_DECAY;
  // Snap when within rounding distance so the stored value settles exactly.
  return Math.abs(next - 1) < 0.0005 ? 1 : clampMultiplier(next);
}
