/**
 * Turn time scale: 48 turns = 1 year. 1 turn = 1 week (game calendar).
 * Last turn of year (turn 48) represents December (4 weeks).
 *
 * MS_PER_TURN: Wall-clock ms per turn. Cron runs hourly, so 1 turn = 1 real hour.
 * Used for election timestamps (endTime, startTime) so House 96t = 96h = 4 days.
 */
/**
 * Game-calendar year of turn 1. Turn 1 = first week of January in this year.
 *
 * All canonical-cycle anchors (US House / Senate / President / Governor,
 * UK Commons, DE Bundestag, JP Shugiin / Sangiin) derive from this constant
 * via `(REAL_ELECTION_YEAR − STARTING_YEAR + 1) * TURNS_PER_YEAR` formulas,
 * so shifting STARTING_YEAR consistently moves every election by the same
 * number of turns. Real-world 2019 elections (UK Dec 2019 GE, JP Jul 2019
 * Sangiin Class 2) are bootstrap-skipped: the formulas reference the
 * NEXT real-world election (UK 2024, JP 2022) directly, so the 2019
 * cycle never spawns in-game.
 */
export const STARTING_YEAR = 2019;

/** UK starting year. Mirrors STARTING_YEAR. */
export const UK_STARTING_YEAR = 2019;

/**
 * Every canonical reset preset, OLDEST FIRST.
 *
 * The order is load-bearing for callers that fall back to "the nearest earlier preset"
 * when a country is absent from the active one — reordering this silently changes which
 * fallback they resolve to. Mirrors the branches in {@link getStartingYearForPreset};
 * the two are pinned together by turnTime's tests.
 */
export const SEED_PRESET_IDS = [
  "1953-default",
  "1979-default",
  "1991-default",
  "1999-default",
  "2007-default",
  "2019-default",
  "2023-default",
] as const;

export type SeedPresetId = (typeof SEED_PRESET_IDS)[number];

/**
 * Map a reset-preset id to its calendar starting year. Used by
 * `resetGameWorld` to set `GameState.currentYear` and `GameState.startingYear`
 * so the game clock matches the preset's era.
 *
 * Election scheduling: `canonicalCycle.ts` consumes a
 * {@link CycleAnchorContext} that bundles `startingYear` + `preset`. The
 * preset-specific real-election years live in
 * `CANONICAL_REAL_ELECTION_YEARS_BY_PRESET` (cycleAnchorContext.ts) and
 * cover US, UK, JP, DE, CN, BR, and IE. The 1991 preset's first US House
 * election correctly anchors to 1992; UK Commons to 1992; JP Shugiin to
 * 1993; DE Bundestag to 1994; CN NPC to 1993; BR Câmara to 1994; IE Dáil
 * to 1992. Older `STARTING_YEAR` constant kept for the default 2019-era
 * legacy callers that don't yet thread `CycleAnchorContext`.
 */
export function getStartingYearForPreset(presetId: string): number {
  if (presetId === "1953-default") return 1953;
  if (presetId === "1979-default") return 1979;
  if (presetId === "1991-default") return 1991;
  if (presetId === "1999-default") return 1999;
  if (presetId === "2007-default") return 2007;
  if (presetId === "2023-default") return 2023;
  // 2019-default and any unknown / empty / "no-parties" variants default to 2019.
  return STARTING_YEAR;
}

/** Milliseconds per turn (1 real hour — cron runs hourly). Used for election timestamps. */
export const MS_PER_TURN = 60 * 60 * 1000;

/** Turns per year. 48 turns = 1 year. */
export const TURNS_PER_YEAR = 48;

/**
 * Max turns retained for exchange-rate history and central-bank macro snapshots
 * (policy rate, inflation, GDP growth) used on forex charts — matches the stock
 * market “5y” window (5 in-game years).
 */
export const FOREX_AND_MACRO_CHART_HISTORY_TURNS = TURNS_PER_YEAR * 5;

/**
 * Turns per financial day. 24 turns = 1 financial "day" used by the corp
 * simulation (matches the real-time hourly cron: one turn = one hour so a
 * day's worth of revenue/costs spans 24 turns).
 *
 * Sector **growth rate** compounding uses {@link GROWTH_RATE_TURNS_PER_YEAR} (48)
 * instead — one player "day" of growth is spread across a full game year of turns.
 *
 * Re-exports the authoritative constant from `@/lib/constants/corporations`
 * so there's exactly one source of truth — previously this file declared `2`,
 * which disagreed with every call site except stockExchangeSnapshot.ts and
 * caused the snapshot's `dailyInterestCost` to come out 12× smaller than the
 * rest of the codebase expected. The constant is intentionally re-exported
 * here so existing imports from `@/lib/constants/turnTime` keep working.
 */
export { TURNS_PER_DAY, GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";

/**
 * Turn at which the US House initial (Nov 2020) compressed bootstrap ends.
 * Anchored to end of LARP year 2020 (compressed bootstrap collapses the
 * Nov-2020 race into the trailing window of game-year 2020).
 *
 * = (2020 − STARTING_YEAR + 1) × TURNS_PER_YEAR.
 *   STARTING_YEAR=2019 → 96 (end of game-year 2 = end of 2020).
 *   STARTING_YEAR=2020 → 48 (end of game-year 1 = end of 2020).
 */
export const HOUSE_INITIAL_END_TURN = (2020 - STARTING_YEAR + 1) * TURNS_PER_YEAR;

/**
 * Turn at which the US House cycle-2 bootstrap ends (end of LARP year 2022).
 * = (2022 − STARTING_YEAR + 1) × TURNS_PER_YEAR.
 *
 * House elections happen in even years 2020, 2022, 2024, 2026...
 * Cycle 1 = compressed Nov-2020 bootstrap (HOUSE_INITIAL_END_TURN above).
 * Cycle 2 = Nov-2022 bootstrap (this constant, 24h primary + 24h general).
 * From cycle 3 onward, elections recur every 96 turns (2 game-years):
 *   cycle 3 ends LARP year 2024, cycle 4 ends LARP year 2026, etc.
 *
 * STARTING_YEAR=2019 → 192.
 * STARTING_YEAR=2020 → 144.
 */
export const HOUSE_CYCLE1_END_TURN = (2022 - STARTING_YEAR + 1) * TURNS_PER_YEAR;

/**
 * Turn at which the UK Commons cycle-1 election ends.
 * Anchored to the July 2024 UK general election (Week 27 of LARP year 2024).
 * The Dec 2019 UK GE is bootstrap-skipped — the formula goes directly to
 * 2024 as the first in-game cycle.
 *
 * STARTING_YEAR=2019 → 267.
 * STARTING_YEAR=2020 → 219.
 *
 * Subsequent elections are spaced UK_COMMONS_CYCLE_PERIOD_HOURS apart.
 */
export const UK_COMMONS_CYCLE1_END_TURN = (2024 - STARTING_YEAR) * TURNS_PER_YEAR + 27;

/**
 * UK parliamentary cycle period in hours (= turns).
 * 5 game-years × 48 turns/year = 240 turns.
 * Each election lasts 48h (24h primary + 24h general); the remaining 192h
 * is a gap before the next election spawns.
 */
export const UK_COMMONS_CYCLE_PERIOD_HOURS = TURNS_PER_YEAR * 5; // 240

/**
 * Senate class stagger in turns from game start (2020).
 * Matches real US election schedule:
 *   Class 2 elected 2020 → stagger 0
 *   Class 3 elected 2022 → stagger 96  (2 years × 48 turns/year)
 *   Class 1 elected 2024 → stagger 192 (4 years × 48 turns/year)
 */
export const SENATE_STAGGER_TURNS: Record<number, number> = {
  1: 192,
  2: 0,
  3: 96,
};

/**
 * JP Sangiin (House of Councillors) bootstrap end-turns.
 * Half-elections every 3 game years, staggered by class.
 * Real elections: Class 1 = July 2022, Class 2 = July 2025.
 * July ≈ week 27 of the year. The Jul 2019 Class 2 election is
 * bootstrap-skipped — Class 2 cycle 1 jumps directly to Jul 2025.
 *
 * STARTING_YEAR=2019 → { 1: 171, 2: 315 }.
 * STARTING_YEAR=2020 → { 1: 123, 2: 267 }.
 */
export const JP_SANGIIN_CYCLE1_END_TURN: Record<number, number> = {
  1: (2022 - STARTING_YEAR) * TURNS_PER_YEAR + 27,
  2: (2025 - STARTING_YEAR) * TURNS_PER_YEAR + 27,
};

/**
 * JP Sangiin term length in turns (1 turn = 1 real hour). A Councillor serves 6 game years
 * per class. Half-elections every 3 years contest one class at a time, so the
 * stagger between Class 1 and Class 2 end turns is 144, but each class's own
 * cycle period is the full 6-year term (288 turns).
 *
 * This is distinct from `DEFAULT_DURATIONS.sangiin.durationHours` (144h), which
 * sets the active election window (primary + general). The two differ: the race
 * is only "active" for the last 3 years of the 6-year term.
 */
export const JP_SANGIIN_CYCLE_PERIOD_HOURS = TURNS_PER_YEAR * 6; // 288

/**
 * Number of turns (= real-time hours) after a PM vacancy begins before an
 * auto-snap is triggered. Applies to any transition of
 * governmentFormations.status into "pending" — post-election, post-NC pass,
 * or admin-initiated vacancy.
 *
 * 96 turns = 4 real-time days = ~2 game years. Captures both the UK
 * post-FTPA convention (14-day window) and JP Article 69 (10-day window)
 * scaled to game-time pacing.
 */
export const PM_VACANCY_DEADLINE_TURNS = 96;
