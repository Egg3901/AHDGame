/**
 * UK cabinet reshuffle limit (epic #856, ticket #859 — Cluster B).
 *
 * Decision of record (ops-knowledge `uk-rework-design-2026-08-25`): the PM can
 * replace the ENTIRE cabinet in one action — a reshuffle — but only ONCE PER
 * PARLIAMENT PER GOVERNMENT. (Firing individual ministers is separate and
 * unlimited, but each hits the confidence gauge; see `confidenceGauge.ts`.)
 *
 * Pure limiter: it reads a log of prior reshuffles and decides whether another
 * is allowed for a given government + parliament. Persistence lives elsewhere.
 */

export interface ReshuffleRecord {
  /** The government instance (a PM's ministry; resets when a new government forms). */
  governmentId: string;
  /** The parliament term (resets on dissolution / general election). */
  parliamentId: string;
  at: Date;
}

export interface ReshuffleDecision {
  allowed: boolean;
  reason: string;
}

/**
 * May this government reshuffle in this parliament? Allowed unless a reshuffle is
 * already recorded for the same (governmentId, parliamentId).
 */
export function canReshuffle(
  log: ReshuffleRecord[],
  governmentId: string,
  parliamentId: string
): ReshuffleDecision {
  const used = log.some((r) => r.governmentId === governmentId && r.parliamentId === parliamentId);
  return used
    ? { allowed: false, reason: "already reshuffled this parliament" }
    : { allowed: true, reason: "reshuffle available" };
}

/**
 * Append a reshuffle to the log if permitted. Returns the (possibly unchanged)
 * log and whether it was recorded — pure, so callers persist the result.
 */
export function recordReshuffle(
  log: ReshuffleRecord[],
  governmentId: string,
  parliamentId: string,
  at: Date
): { log: ReshuffleRecord[]; recorded: boolean } {
  if (!canReshuffle(log, governmentId, parliamentId).allowed) {
    return { log, recorded: false };
  }
  return { log: [...log, { governmentId, parliamentId, at }], recorded: true };
}
