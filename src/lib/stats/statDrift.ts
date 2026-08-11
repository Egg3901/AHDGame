import {
  ENERGY_BASE_ACTION_CAP,
  ENERGY_MAX_ACTION_CAP,
  ENERGY_BASE_HOARD_THRESHOLD,
  ENERGY_MAX_HOARD_THRESHOLD,
  GENERIC_DRIFT_STATS,
  STAT_MIN,
  STAT_MAX,
  clampStat,
  type CharacterStats,
  type StatXp,
} from "./statsConstants";

/**
 * Energy-scaled action economy limits. Linear from the baseline at Energy 1 to
 * the max at Energy 10. A character with no Energy stat (unmigrated) should be
 * passed `STAT_MIN` by the caller so they keep exact baseline limits.
 */
export function energyActionLimits(energy: number): { cap: number; threshold: number } {
  const t = (clampStat(energy) - STAT_MIN) / (STAT_MAX - STAT_MIN); // 0 at stat 1, 1 at stat 10
  return {
    cap: Math.round(ENERGY_BASE_ACTION_CAP + t * (ENERGY_MAX_ACTION_CAP - ENERGY_BASE_ACTION_CAP)),
    threshold: Math.round(
      ENERGY_BASE_HOARD_THRESHOLD + t * (ENERGY_MAX_HOARD_THRESHOLD - ENERGY_BASE_HOARD_THRESHOLD)
    ),
  };
}

/**
 * Apply one turn of generic stat drift: flush accumulated use-growth XP into the
 * stat, then apply idle decay **only when the stat went unused this turn**. All
 * clamped to [1, 10]. Debate is excluded (handled by `applyDebateDecay`). Returns
 * the next stats plus a zeroed XP ledger (XP is consumed each turn).
 *
 * "Use it or lose it": engaging a skill stat's loop (XP > 0) staves off decay, so
 * active play never nets a loss on the stat it trained — this is what lets a
 * once-per-turn signal like the CEO Business-Acumen tick actually climb instead
 * of bleeding out. Energy is a stamina stat that accrues XP on every action, so a
 * flat "any use → no decay" rule would make it a free ratchet; it only avoids
 * decay when the turn's activity clears `ENERGY_MAINTENANCE_XP`. Neglected stats
 * slip back toward the floor at `IDLE_DECAY_RATE`.
 */
export function applyTurnDrift(
  stats: CharacterStats,
  statXp: StatXp | undefined
): { stats: CharacterStats; statXp: StatXp } {
  const next = { ...stats };
  for (const key of GENERIC_DRIFT_STATS) {
    const xp = statXp?.[key] ?? 0;
    // No idle decay — stats are permanent unless lost through random events.
    // Only use-growth XP is applied.
    next[key] = clampStat(next[key] + xp);
  }
  return { stats: next, statXp: {} };
}
