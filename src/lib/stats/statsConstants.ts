/**
 * Central constants and types for the RPG stat system (Fallout-SPECIAL style).
 *
 * Seven stats, each a float clamped to [1, 10], allocated at character creation
 * from a fixed point budget and shaped by play (use-growth + idle decay +
 * events). Every magnitude here is a tunable constant — balance is expected to
 * be adjusted after playtesting. See plans/2026-06-18-rpg-stats-overhaul-design.md.
 */

/** The seven stat keys, in canonical display order. */
export const STAT_KEYS = [
  "charisma",
  "debate",
  "energy",
  "fundraising",
  "businessAcumen",
  "statecraft",
  "intellect",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

/** Persisted under `character.stats`. Each value is a float clamped to [1, 10]. */
export type CharacterStats = Record<StatKey, number>;

/**
 * Fractional use-drift progress for the generic-drift stats only. When a stat's
 * accumulated XP crosses ±1 the integer stat is nudged and the remainder kept.
 * Debate is excluded — it has bespoke progression (Debate Prep + debate
 * participation + a real-time 72h decay clock).
 */
export type StatXp = Partial<Record<StatKey, number>>;

/**
 * Stats that move via the generic use-growth + idle-decay mechanism. Debate is
 * intentionally absent: it is raised by the Debate Prep action and by debating in
 * elections, and decays on a real-time 72h clock.
 */
export const GENERIC_DRIFT_STATS: readonly StatKey[] = STAT_KEYS.filter((k) => k !== "debate");

// ── Range & allocation ──────────────────────────────────────────────────────
export const STAT_MIN = 1;
export const STAT_MAX = 10;
/** Total points spent across all seven stats at creation (min 1 each → 21 free). */
export const STAT_POINT_BUDGET = 28;
/** Free points distributable above the 1-floor: 28 − 7. */
export const STAT_FREE_POINTS = STAT_POINT_BUDGET - STAT_KEYS.length;

// ── Efficacy multiplier ───────────────────────────────────────────────────────
/** Gentle ±20% swing: slope per point away from the pivot. */
export const EFFICACY_SLOPE = 0.04;
/** Stat value that yields a neutral 1.0× multiplier. */
export const EFFICACY_PIVOT = 5.5;
/** Neutral fallback for characters that predate the stat system (pre-migration). */
export const NEUTRAL_STAT = EFFICACY_PIVOT;

// ── Energy → action economy ───────────────────────────────────────────────────
/** Action cap at Energy 1 (baseline) and Energy 10 (max). */
export const ENERGY_BASE_ACTION_CAP = 200;
export const ENERGY_MAX_ACTION_CAP = 250;
/** Hoard threshold at Energy 1 (baseline) and Energy 10 (max). */
export const ENERGY_BASE_HOARD_THRESHOLD = 100;
export const ENERGY_MAX_HOARD_THRESHOLD = 125;

// ── Generic drift ─────────────────────────────────────────────────────────────
/** XP added to a stat each time its qualifying action is performed. */
export const USE_GROWTH_INCREMENT = 0.03;
/**
 * Per-turn idle decay applied to a generic-drift stat ONLY when the stat was not
 * engaged that turn (clamped ≥ STAT_MIN). "Use it or lose it": engaging a stat's
 * loop staves off decay so active play never nets a loss on the stat it trained.
 */
export const IDLE_DECAY_RATE = 0.05;
/**
 * Energy is a stamina stat, not a skill: it accrues XP on every action, so a flat
 * "any use → no decay" rule would make it a free ratchet. Instead it only avoids
 * decay when the turn's accrued activity clears this maintenance threshold
 * (≈ two actions' worth), tying Energy to *sustained* activity.
 */
export const ENERGY_MAINTENANCE_XP = USE_GROWTH_INCREMENT * 2;

/**
 * Business Acumen is trained by running a corporation, and a *better-run* corp
 * teaches more. Scales the per-turn CEO Business-Acumen XP by the corp's realized
 * profit margin this turn: a money-losing corp trains slowly, a highly profitable
 * one trains fast. Returned multiplier is applied to `USE_GROWTH_INCREMENT`.
 */
export function businessAcumenGrowthMultiplier(profitMargin: number): number {
  if (profitMargin <= 0) return 0.5; // unprofitable — scraping by, learn little
  if (profitMargin <= 0.1) return 1.0; // thin margin — baseline
  if (profitMargin <= 0.25) return 1.5; // healthy
  return 2.0; // highly profitable — running a tight ship
}

// ── Debate (bespoke) ──────────────────────────────────────────────────────────
export const DEBATE_PREP_ACTION_COST = 1;
export const DEBATE_PREP_SUCCESS_CHANCE = 0.15;
/** Real-time decay window: −1 Debate per full 72 hours. */
export const DEBATE_DECAY_INTERVAL_MS = 72 * 60 * 60 * 1000;
/**
 * Debate is also trained by *debating*: each resolved debate gives a character
 * participant a free practice roll to +1 Debate. The winner learns more than the
 * loser, so growth is tied to the activity itself, not just the prep grind.
 */
export const DEBATE_PRACTICE_WIN_CHANCE = 0.3;
export const DEBATE_PRACTICE_BASE_CHANCE = 0.15;

/** Clamp a stat value to the legal [STAT_MIN, STAT_MAX] range. */
export function clampStat(value: number): number {
  return Math.min(STAT_MAX, Math.max(STAT_MIN, value));
}
