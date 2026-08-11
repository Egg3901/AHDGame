import {
  STAT_KEYS,
  STAT_MIN,
  STAT_MAX,
  STAT_POINT_BUDGET,
  type CharacterStats,
} from "./statsConstants";

export type StatAllocationResult =
  { ok: true; stats: CharacterStats } | { ok: false; error: string };

/**
 * Pure validator for a creation/grandfather stat allocation. Enforces the full
 * contract: exactly the seven canonical keys, each an integer in [1, 10], and a
 * total of exactly 28 points. Returns the typed stats on success so callers can
 * persist the validated object directly.
 */
export function validateStatAllocation(input: unknown): StatAllocationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Stats must be an object." };
  }

  const keys = Object.keys(input as Record<string, unknown>);
  if (keys.length !== STAT_KEYS.length) {
    return { ok: false, error: `Expected exactly ${STAT_KEYS.length} stats.` };
  }

  const stats = {} as CharacterStats;
  let sum = 0;
  for (const key of STAT_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return { ok: false, error: `Stat "${key}" must be an integer.` };
    }
    if (value < STAT_MIN || value > STAT_MAX) {
      return { ok: false, error: `Stat "${key}" must be between ${STAT_MIN} and ${STAT_MAX}.` };
    }
    stats[key] = value;
    sum += value;
  }

  if (sum !== STAT_POINT_BUDGET) {
    return { ok: false, error: `Stats must total exactly ${STAT_POINT_BUDGET} (got ${sum}).` };
  }

  return { ok: true, stats };
}
