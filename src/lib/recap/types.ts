import type { GameIteration, ActionType } from "@/lib/db/types/gameState";

/**
 * A stat with the player's value plus their leaderboard position, so the story
 * UI can render a percentile without recomputing. `rank` is 1-based within
 * `total` ranked peers (ranked per country). `rank === null` means unranked
 * (zero/negative value, or a mid-season solo retire where the field wasn't
 * scanned). Percentile = 1 - (rank - 1) / total.
 */
export interface RecapRankedStat {
  value: number;
  rank: number | null;
  total: number;
}

export interface RecapAchievementHighlight {
  name: string;
  icon: string | null;
}

/** Per-action-type counts for the just-ended life (from actionLogs). */
export type RecapActionBreakdown = Partial<Record<ActionType, number>>;

/**
 * Frozen end-of-life snapshot of a character's season, computed at retirement
 * BEFORE the reset wipes actionLogs/bills/snapshots, then stored on the
 * RetiredCharacter doc (`recap`). Every stat group is nullable/zeroable so the
 * story UI can skip empty slides for a low-activity character. `schemaVersion`
 * guards against silently rendering a stale shape after future field changes —
 * bump it and branch in the UI when the payload changes incompatibly.
 */
export interface CharacterRecap {
  schemaVersion: 1;
  characterId: string;
  name: string;
  /** Resolved party display name at retirement (e.g. "Democratic Party"). */
  party: string;
  countryId: string;
  /** The season this life belonged to (outgoing iteration), for the title. */
  iteration: GameIteration | null;
  /** Turns the character was alive (outgoing currentTurn − createdTurn). */
  tenureTurns: number;
  highestOffice: string | null;
  actions: {
    total: number;
    byType: RecapActionBreakdown;
    /** Signature move — the most-used action type, or null if no actions. */
    topType: ActionType | null;
    /** Rank by total action count (null on mid-season solo retires). */
    rank: RecapRankedStat | null;
  };
  influence: {
    politicalInfluence: number;
    nationalInfluence: number;
    /** Rank by the npi metric (nationalInfluence, then politicalInfluence). */
    npi: RecapRankedStat | null;
  };
  favorability: RecapRankedStat | null;
  infamy: number;
  /** campaignFunds + cashOnHand + portfolioValue, ranked. */
  netWorth: RecapRankedStat | null;
  campaignFunds: RecapRankedStat | null;
  elections: { entered: number; won: number; lost: number };
  bills: { sponsored: number; passed: number };
  /** Omitted (null) when the character never engaged the news wire. */
  social: { subscribers: number; posts: number; likes: number } | null;
  achievements: { count: number; highlights: RecapAchievementHighlight[] };
}
