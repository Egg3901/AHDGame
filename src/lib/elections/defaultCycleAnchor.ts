/**
 * Shared "default cycle" anchor for party-leadership elections.
 *
 * Default parties all run their leadership elections in lockstep: created
 * together after a world reset and recreated together at endTurn. A party
 * that appears mid-cycle (a freshly chartered party, or a party whose
 * election went missing) must join that shared cadence instead of starting
 * its own `currentTurn + duration` cycle and drifting forever.
 *
 * The anchor is the modal (most common) effective end turn among active
 * default-duration elections — self-healing and independent of which turn
 * the first post-reset creation phase happened to run. Quorum-accelerated
 * elections contribute their pre-acceleration `originalEndTurn` (the natural
 * cycle end), not the halved `endTurn`.
 */
export interface CycleAnchorCandidate {
  countryId?: string;
  durationTurns?: number;
  endTurn?: number;
  originalEndTurn?: number;
}

export function resolveDefaultCycleEndTurn(
  candidates: CycleAnchorCandidate[],
  opts: { defaultDurationTurns: number; currentTurn: number; countryId?: string }
): number {
  const { defaultDurationTurns, currentTurn, countryId } = opts;

  const effectiveEnd = (c: CycleAnchorCandidate): number | undefined =>
    c.originalEndTurn ?? c.endTurn;

  const valid = candidates.filter((c) => {
    const end = effectiveEnd(c);
    return c.durationTurns === defaultDurationTurns && typeof end === "number" && end > currentTurn;
  });

  const countryPool = countryId ? valid.filter((c) => (c.countryId ?? "US") === countryId) : valid;
  const pool = countryPool.length > 0 ? countryPool : valid;

  if (pool.length === 0) return currentTurn + defaultDurationTurns;

  const counts = new Map<number, number>();
  for (const c of pool) {
    const end = effectiveEnd(c) as number;
    counts.set(end, (counts.get(end) ?? 0) + 1);
  }
  let modal = currentTurn + defaultDurationTurns;
  let best = 0;
  for (const [end, count] of counts) {
    if (count > best || (count === best && end < modal)) {
      modal = end;
      best = count;
    }
  }
  return modal;
}
