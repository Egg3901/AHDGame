/** Plain-data rules for probabilistic bill-lifecycle decisions. */

export interface RevisionDelayRule {
  chance: number;
  delayTurnsMin: number;
  delayTurnsMax: number;
}

/** Return a Lords revision delay, or null when the bill proceeds immediately. */
export function resolveRevisionDelay(rule: RevisionDelayRule, rng: () => number): number | null {
  if (rule.chance <= 0 || rng() >= rule.chance) return null;
  const min = Math.max(1, Math.trunc(rule.delayTurnsMin));
  const max = Math.max(min, Math.trunc(rule.delayTurnsMax));
  if (max === min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}
