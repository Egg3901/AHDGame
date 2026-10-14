import type { CountryId } from "@/lib/constants/countries";

/** "all" ranks every life ever played; "current" only ranks lives from the active game iteration. */
export type LegacyLeaderboardScope = "all" | "current";

/** "legacy" ranks by the balanced career score; "netWorth" ranks by forex-normalized net worth. */
export type LegacyRankBy = "legacy" | "netWorth";

/**
 * Per-component contribution to a life's composite Legacy Score (already
 * weighted - sum these to get `score`). Powers the score-breakdown UI.
 */
export interface LegacyScoreBreakdown {
  nationalInfluence: number;
  partyInfluence: number;
  achievements: number;
  officeTier: number;
  /** Negative or zero: infamy only ever subtracts. */
  infamyPenalty: number;
  wealth: number;
  legislation: number;
  contests: number;
}

/**
 * Net worth = personal wealth (cashOnHand) + savings + held corp shares +
 * held bonds + held index-fund positions, all forex-normalized to internal
 * units. Read at retirement time for retired lives, or the current balance
 * for active ones - NOT a true per-turn historical peak (that would need a
 * separate time-series scan this leaderboard doesn't do). For retired lives,
 * shares/bonds/indexFunds are 0 on snapshots taken before those fields
 * existed - that value was already released with no record by the time the
 * field was added, unrecoverable for already-retired characters.
 */
export interface LegacyNetWorthBreakdown {
  personal: number;
  savings: number;
  shares: number;
  bonds: number;
  indexFunds: number;
  /** Negative contribution from outstanding personal loans. */
  debt: number;
}

/** One account's career record, with political and business stats from its strongest life. */
export interface LegacyLeaderboardEntry {
  rank: number;
  userId: string;
  /** Resolved per the user's `legacyDisplayCharacterId` preference; defaults to the current or latest character. */
  displayName: string;
  scoringCharacterId: string;
  scoringCharacterName: string;
  displayCharacterId: string;
  enactedBills: number;
  contestWins: number;
  contestPodiums: number;
  scoreVersion: number;
  countryId: CountryId;
  homeState: string;
  /** Label of the iteration ("Beta 2", "Iteration 1", ) the scoring life belonged to. */
  iterationLabel: string;
  /** Balanced career score. Portable formula: world/rules/careerScore.ts. */
  score: number;
  scoreBreakdown: LegacyScoreBreakdown;
  /** Forex-normalized net worth (internal units) of the life this entry is scored/ranked on. */
  netWorth: number;
  netWorthBreakdown: LegacyNetWorthBreakdown;
  nationalInfluence: number;
  partyInfluence: number;
  achievementCount: number;
  highestOffice: string | null;
  avatarUrl: string | null;
  /** True when the displayed identity is a still-active character. */
  isActive: boolean;
  /** Total number of lives (current + retired) this user has on record, across all time regardless of scope. */
  lifetimeLives: number;
}

/** A single life (current or retired) a user can pick as their display name. */
export interface LegacyLifeOption {
  characterId: string;
  name: string;
  isActive: boolean;
  iterationLabel: string;
  score: number;
  retiredAt: string | null;
}

export interface LegacyLeaderboardData {
  entries: LegacyLeaderboardEntry[];
  total: number;
  self: {
    rank: number | null;
    lives: LegacyLifeOption[];
    /** Current preference: "current", a characterId, or null (default = current or latest character). */
    displayPreference: string | null;
  } | null;
}
