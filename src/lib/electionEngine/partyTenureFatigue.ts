/**
 * Party-tenure "voter fatigue" penalty for executive own-races.
 *
 * A party that has held the presidency for many consecutive terms faces a
 * thermostatic backlash — the real-world "time for a change" effect that makes
 * a 4th consecutive term a genuine slog even for a popular incumbent. This is
 * modelled as a drag subtracted from the incumbency driver AFTER the approval
 * shield/drag is computed and capped, so it bites popular incumbents too (who
 * otherwise sit at the +10pp shield cap and would feel no fatigue).
 *
 * Schedule, keyed to the number of consecutive terms the party has ALREADY
 * held (i.e. the incumbent is seeking `consecutiveTerms + 1`):
 *
 *   terms held | seeking | penalty
 *   ---------- | ------- | -------
 *        1     |   2nd   |   0
 *        2     |   3rd   |  −3.5
 *        3     |   4th   |  −7.0
 *        4     |   5th   |  −10.5
 *       +1     |  +1     |  −3.5 more
 *
 * i.e. `penalty = 3.5 × max(0, consecutiveTerms − 1)` percentage points.
 *
 * Units: the incumbency driver works in internal budget units where the panel
 * displays `budget × 100` as "pts of the persuadable slice". A 3.5-pt penalty
 * is therefore `0.035` in budget units. (This also happens to equal a
 * 3.5-approval-point shift in the un-capped region, since the approval curve's
 * slope is 0.01 — but subtracting post-cap is what makes it bite popular
 * incumbents, per the design decision on ticket #943.)
 */

/** Penalty per consecutive term beyond the first, in incumbency-budget units (3.5 panel pts). */
export const TENURE_FATIGUE_PER_TERM = 0.035 as const;

/**
 * Voter-fatigue penalty (budget units, ≥ 0) for a party that has held the
 * executive office for `consecutiveTerms` consecutive terms and is now seeking
 * another. Returns 0 for the first re-election (2nd term) and for any
 * missing / non-positive count.
 */
export function partyTenureFatiguePenalty(consecutiveTerms: number | undefined): number {
  if (consecutiveTerms == null || !Number.isFinite(consecutiveTerms)) return 0;
  return Math.max(0, Math.floor(consecutiveTerms) - 1) * TENURE_FATIGUE_PER_TERM;
}
