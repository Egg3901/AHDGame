/**
 * The settlement index and the grid it lives on.
 *
 * INVARIANT: a crisis's `position` is ALWAYS the weight-normalised mean of its
 * institutions' positions. Nothing else may write it. That is what makes the
 * masthead figure and the institution cards incapable of disagreeing.
 *
 * Everything is integer hundredths, for the reason set out at length in
 * `src/lib/alignment/normalize.ts`: a weighted mean recomputed each turn on a
 * float grid accumulates dust, and the one number players read would slowly
 * stop matching the four numbers it is derived from.
 */
import type { SettlementInstitutionState } from "@/lib/db/types/settlementCrisis";
import { HUNDREDTHS } from "@/lib/constants/settlementCrisis";

/** Lowest and highest storable position, in hundredths. */
const MIN_POSITION = 0;
const MAX_POSITION = 100 * HUNDREDTHS;

/** Snap onto the grid and hold inside its bounds. */
export function clampPosition(hundredths: number): number {
  const rounded = Math.round(hundredths);
  if (rounded < MIN_POSITION) return MIN_POSITION;
  if (rounded > MAX_POSITION) return MAX_POSITION;
  return rounded;
}

/**
 * The weighted mean of the institutions, in hundredths.
 *
 * Divides by the ACTUAL summed weight rather than by a constant, so a partial
 * institution list still produces a coherent mean instead of a silently
 * deflated one.
 */
export function recomputePosition(institutions: readonly SettlementInstitutionState[]): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const inst of institutions) {
    weighted += inst.position * inst.weight;
    totalWeight += inst.weight;
  }
  if (totalWeight <= 0) return 0;
  return clampPosition(weighted / totalWeight);
}

/** A copy of `state` moved by a signed delta in hundredths. */
export function applyToInstitution(
  state: SettlementInstitutionState,
  deltaHundredths: number
): SettlementInstitutionState {
  return { ...state, position: clampPosition(state.position + deltaHundredths) };
}

/** Storage hundredths to display points. Display only — never feed this to a gate. */
export function toPoints(hundredths: number): number {
  return hundredths / HUNDREDTHS;
}
