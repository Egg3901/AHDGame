import type { Db } from "mongodb";
import { getVietnamEscalation, VIETNAM_MAX_LEVEL } from "./vietnamEscalation";

/**
 * Small, stable interface onto the Vietnam War escalation level, so the 1960s
 * protest crises (anti-war marches especially) can scale their spawn weight and
 * severity to how deep the US commitment has gotten.
 *
 * The real ladder lives in `vietnamEscalation.ts` and is database state, so
 * reading it is asynchronous. Template spawn weights are read synchronously by
 * the auto-spawner, so this module holds the last known reading in a
 * process-local cache: `refreshVietnamEscalationLevel` pulls the ladder once per
 * turn (from the crisis turn and from the auto-spawner itself) and
 * `getVietnamEscalationLevel` serves that reading to template getters.
 *
 * The cache starts at 0, so a world with no Vietnam war, a process that has not
 * yet run a turn, and a unit test that never touches the database all see the
 * unescalated floor rather than an error or an over-firing template.
 */

let cachedNormalizedLevel = 0;

/**
 * Current Vietnam War escalation, normalized to 0 (no US involvement) through
 * 1 (peak commitment, the long war). Callers should treat this as a continuous
 * dial, not a stage index.
 */
export function getVietnamEscalationLevel(): number {
  return cachedNormalizedLevel;
}

/** Map a ladder rung (0..VIETNAM_MAX_LEVEL) onto the 0-1 dial. */
export function normalizeVietnamLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(1, level / VIETNAM_MAX_LEVEL));
}

/** Set the cached reading directly. For tests and for the refresh below. */
export function setVietnamEscalationLevel(normalized: number): void {
  cachedNormalizedLevel = Math.max(0, Math.min(1, normalized));
}

/** Pull the live ladder into the cache. Returns the new normalized reading. */
export async function refreshVietnamEscalationLevel(db: Db): Promise<number> {
  const state = await getVietnamEscalation(db);
  setVietnamEscalationLevel(normalizeVietnamLevel(state.level));
  return cachedNormalizedLevel;
}
