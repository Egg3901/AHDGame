/**
 * Phase-in for enacted tax-rate changes.
 *
 * Ticket #1102. The Poon Choi Act sat at 0% for 67 turns because of an
 * enactment bug, and when the fix landed the real rate arrived in a single
 * turn. The player's words were that it "put us in a crazy recession", which is
 * what a five-point consumption-tax step does to an economy that had priced
 * itself around zero.
 *
 * The bug is fixed, but the sharp edge is general: any large rate move, whether
 * a correction or a deliberate budget, lands in one turn. Rates now walk toward
 * their target at most {@link TAX_RATE_PHASE_IN_MAX_STEP_PP} points per turn.
 *
 * Deliberately NOT a delay. The enacted rate starts moving the same turn the
 * bill passes, and the target is exactly what the legislature voted for. Only
 * the speed of arrival changes, so a player cannot game the ramp by timing and
 * the law never means something other than what it says.
 *
 * Small changes are unaffected: anything within one step applies whole, so
 * routine budget tinkering behaves exactly as it did before.
 */

/** Most a tax rate may move in one turn, in percentage points. */
export const TAX_RATE_PHASE_IN_MAX_STEP_PP = 1;

function finite(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * True when a move from `current` to `target` is big enough to ramp. A change
 * inside one step is applied whole and never records a pending target.
 */
export function needsPhaseIn(current: number | null | undefined, target: number): boolean {
  return Math.abs(target - finite(current)) > TAX_RATE_PHASE_IN_MAX_STEP_PP;
}

/**
 * Next rate on the way to `target`, moving at most one step and never
 * overshooting. Returns the target itself once it is within reach, which is how
 * the caller knows the ramp is finished.
 */
export function stepTaxRate(current: number | null | undefined, target: number): number {
  const from = finite(current);
  const to = finite(target);
  const delta = to - from;
  if (Math.abs(delta) <= TAX_RATE_PHASE_IN_MAX_STEP_PP) return to;
  const next = from + Math.sign(delta) * TAX_RATE_PHASE_IN_MAX_STEP_PP;
  // Guard the float: 0.1 steps accumulate error that would leave a rate a
  // hair off its target forever and keep the phase-in entry alive.
  return Math.round(next * 1000) / 1000;
}

/** Turns a move of this size will take to complete. Display and tests. */
export function phaseInTurns(current: number | null | undefined, target: number): number {
  return Math.ceil(Math.abs(finite(target) - finite(current)) / TAX_RATE_PHASE_IN_MAX_STEP_PP);
}

/**
 * Advance every pending target by one turn.
 *
 * Returns the new rates and the targets still outstanding, with reached ones
 * dropped so the pending map empties itself rather than needing a sweep.
 */
export function advanceTaxRatePhaseIn(
  rates: Record<string, number | null | undefined>,
  pending: Record<string, number> | undefined
): { rates: Record<string, number>; pending: Record<string, number>; changed: boolean } {
  const nextRates: Record<string, number> = {};
  const nextPending: Record<string, number> = {};
  let changed = false;

  for (const [taxType, target] of Object.entries(pending ?? {})) {
    if (typeof target !== "number" || !Number.isFinite(target)) continue;
    const current = finite(rates[taxType]);
    const stepped = stepTaxRate(current, target);
    if (stepped !== current) {
      nextRates[taxType] = stepped;
      changed = true;
    }
    if (stepped !== target) nextPending[taxType] = target;
    else changed = true; // reaching the target clears the entry, which is a change
  }

  return { rates: nextRates, pending: nextPending, changed };
}
