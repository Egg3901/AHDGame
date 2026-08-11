/**
 * Whether a policy pushes a metric's displayed VALUE up.
 *
 * `weightedDirection` is the policy's good/bad *intent* on the metric
 * (Σ target.weight × policyDirection). To convert intent → value direction we
 * apply the same `isHigherBetter` flip the tick-rate uses
 * (`src/lib/api/stateTickRates.ts`): for a lower-is-better metric, an improving
 * policy moves the value DOWN. Keeping these consistent stops the
 * "↑ Pushing up" badge from contradicting the net Active Policy Effect.
 */
export function pushesValueUp(weightedDirection: number, isHigherBetter: boolean): boolean {
  return weightedDirection * (isHigherBetter ? 1 : -1) > 0;
}
