/**
 * Bounds of a legislation type's policy-option ladder.
 *
 * Most types carry a seven-option (0-6) ladder, and both the order server and
 * the issue-order modal used to hardcode that shape. Shorter ladders exist -
 * the state redistricting authority act has three options - and on those the
 * constants pointed off the end: the default index 3 was out of range, and the
 * clamp at 6 let an order settle on an index with no option behind it. A
 * written-out-of-range index is not inert, because readers reinterpret it
 * (redistricting caps clamp an unknown index back to the centre), so the order
 * and the mechanic it drives disagree.
 *
 * Shared by the order route, the order modal and the bill-proposal modals, so
 * the options a player is shown and the index the server resolves cannot drift
 * apart.
 *
 * `centerIndex` is the floor midpoint, matching what billEnactment already
 * resolves a missing prior policy to. Deliberately NOT `ladderCenterIndex` from
 * ./optionIntensity, which finds the centre-STANCE option: that is the right
 * answer for intensity math but would move the default off 3 for existing
 * seven-option ladders whose centre stance sits elsewhere. On a seven-option
 * ladder this returns exactly the 0-6/centre-3 shape that was hardcoded before,
 * so no existing type changes behaviour.
 *
 * A type with no options ladder keeps the legacy 0-6 bounds rather than
 * collapsing to a single index.
 */
export interface LadderBounds {
  /** Highest selectable option index. */
  maxIndex: number;
  /** Index used when a state has no prior policy for the type. */
  centerIndex: number;
}

export const LEGACY_LADDER_BOUNDS: LadderBounds = { maxIndex: 6, centerIndex: 3 };

export function ladderBounds(optionCount: number | undefined | null): LadderBounds {
  if (!Number.isInteger(optionCount) || (optionCount as number) <= 0) {
    return LEGACY_LADDER_BOUNDS;
  }
  const n = optionCount as number;
  return { maxIndex: n - 1, centerIndex: Math.floor(n / 2) };
}
