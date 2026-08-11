/*
 * Decay rate per turn: 0.25% of remaining distance from baseline.
 * This is a proportional (exponential) decay, not a flat subtraction, so
 * metrics never overshoot their baseline. At 0.25%/turn a metric displaced
 * by 10 points returns to within 1 point of baseline in ~920 turns (~19 game
 * years), creating very gradual long-term reversion while policy effects and
 * player actions can sustain deviation for years if maintained continuously.
 */
const DECAY_RATE = 0.0025;

/** Minimum distance to bother decaying (avoids floating point churn) */
const DECAY_THRESHOLD = 0.001;

/**
 * Calculate the new metric value after one turn of natural decay toward baseline.
 * Returns the decayed value.
 */
export function calculateDecay(currentValue: number, baseline: number): number {
  const distance = currentValue - baseline;
  if (Math.abs(distance) < DECAY_THRESHOLD) return baseline;
  return currentValue - distance * DECAY_RATE;
}

/**
 * Historical compatibility phase.
 *
 * State metrics are now decayed in `processStatePolicyEffects`, which reads
 * `stateMetrics` and `stateBaselines` together and writes one consolidated
 * update per state. The old standalone phase targeted `stateDemographics`,
 * whose schema has no `{ value, baseline }` metric records, so it was a no-op.
 * Keeping this as an explicit no-op avoids a second writer racing policy
 * effects during the parallel turn phase.
 */
export async function processMetricDecay(): Promise<number> {
  return 0;
}
