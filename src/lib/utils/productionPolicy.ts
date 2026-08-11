/**
 * Trends the current production policy level toward the target by 1 percentage point per turn.
 * Returns an integer clamped to [-25, 25]. Returns current unchanged if already at target.
 *
 * The Math.min(1, ...) guard is kept defensively to prevent overshoot on non-integer inputs,
 * even though in normal operation all values are integers.
 */
export function trendProductionPolicy(current: number, target: number): number {
  if (current === target) return current;
  const step = Math.sign(target - current) * Math.min(1, Math.abs(target - current));
  const next = current + step;
  return Math.max(-25, Math.min(25, Math.round(next)));
}

/** Clamp a raw policy input to a valid integer in [-25, 25]. */
export function clampProductionPolicy(value: number): number {
  return Math.max(-25, Math.min(25, Math.round(value)));
}

/**
 * Compute the revenue multiplier based on production policy level.
 * At +25: 1.10 (+10% revenue)
 * At -25: 0.95 (-5% revenue)
 * Linear interpolation between.
 */
export function getRevenueMultiplier(policyLevel: number): number {
  if (policyLevel >= 0) {
    return 1 + (policyLevel / 25) * 0.1;
  } else {
    return 1 + (Math.abs(policyLevel) / 25) * -0.05;
  }
}

/**
 * Compute the output (supply) multiplier based on production policy level.
 * At +25: 1.15 (+15% output)
 * At -25: 0.90 (-10% output)
 * Linear interpolation between.
 */
export function getOutputMultiplier(policyLevel: number): number {
  if (policyLevel >= 0) {
    return 1 + (policyLevel / 25) * 0.15;
  } else {
    return 1 - (Math.abs(policyLevel) / 25) * 0.1;
  }
}

/**
 * Compute the input (demand) multiplier based on production policy level.
 * At +25: 1.10 (+10% input consumption)
 * At -25: 0.85 (-15% input consumption)
 * Linear interpolation between.
 */
export function getInputMultiplier(policyLevel: number): number {
  if (policyLevel >= 0) {
    return 1 + (policyLevel / 25) * 0.1;
  } else {
    return 1 - (Math.abs(policyLevel) / 25) * 0.15;
  }
}

/** Display info for production policy effects at current level */
export interface PolicyEffectInfo {
  revenue: { multiplier: number; label: string };
  output: { multiplier: number; label: string };
  input: { multiplier: number; label: string };
}

/** Get display-friendly effect info for a given policy level */
export function getPolicyEffectInfo(policyLevel: number): PolicyEffectInfo {
  const revenueMult = getRevenueMultiplier(policyLevel);
  const outputMult = getOutputMultiplier(policyLevel);
  const inputMult = getInputMultiplier(policyLevel);

  const formatPct = (n: number) => {
    const pct = Math.round((n - 1) * 100);
    return pct >= 0 ? `+${pct}%` : `${pct}%`;
  };

  return {
    revenue: { multiplier: revenueMult, label: formatPct(revenueMult) },
    output: { multiplier: outputMult, label: formatPct(outputMult) },
    input: { multiplier: inputMult, label: formatPct(inputMult) },
  };
}
