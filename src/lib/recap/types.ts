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
  /**
   * The characters directly above and below on the same board (v2). Names are
   * public in-game leaderboard data; the story shows them as the player's
   * neighbors in the final standings.
   */
  neighbors?: { above: RecapNeighbor | null; below: RecapNeighbor | null };
}

export interface RecapNeighbor {
  name: string;
  value: number;
}

export interface RecapAchievementHighlight {
  name: string;
  icon: string | null;
}

/** Per-action-type counts for the just-ended life (from actionLogs). */
export type RecapActionBreakdown = Partial<Record<ActionType, number>>;

/** A calendar position on the world's display clock (month is 0-based). */
export interface RecapGameDate {
  year: number;
  month: number;
}

/**
 * One turn-binned activity series across the character's life: `bins[i]` is
 * the action count in turns `[startTurn + i * binTurns, startTurn + (i+1) * binTurns)`.
 */
export interface RecapActivity {
  startTurn: number;
  binTurns: number;
  bins: number[];
  /** Distinct turns with at least one action. */
  activeTurns: number;
  /** Longest run of consecutive turns with at least one action. */
  longestStreak: number;
  /** The single busiest bin, as a calendar span. */
  busiest: { from: RecapGameDate; to: RecapGameDate; actions: number } | null;
}

/** A first-time step up the office ladder ("the climb"). */
export interface RecapCareerStep {
  label: string;
  /** OFFICE_RANK tier, 1 (local council) to 8 (head of government). */
  rank: number;
  turn: number;
  date: RecapGameDate;
}

/** A career event plotted on the season strip. */
export interface RecapCareerMark {
  turn: number;
  kind: "won" | "lost" | "appointed" | "left";
  label: string;
}

export interface RecapRaceCandidate {
  name: string;
  partyName: string;
  color: string;
  votes: number;
  share: number;
  isYou: boolean;
}

/** One finished race from the frozen election-night snapshot. */
export interface RecapRace {
  label: string;
  year: number | null;
  turn: number | null;
  won: boolean;
  /** Seats in the race; margins are only meaningful when 1. */
  seats: number;
  /** Your share minus the nearest rival's (won) or the winner's (lost), in points. */
  marginPct: number;
  /** The same margin in votes. */
  marginVotes: number;
  /** Top of the field, you always included. */
  field: RecapRaceCandidate[];
}

export interface RecapRival {
  name: string;
  partyName: string;
  color: string;
  meetings: number;
  /** Races where you finished ahead of them. */
  ahead: number;
  behind: number;
  /** Most recent meeting first. */
  history: Array<{ label: string; year: number | null; ahead: boolean }>;
}

export interface RecapRaces {
  /** Finished races with a snapshot. */
  contested: number;
  /** Votes cast for you across every race. */
  totalVotes: number;
  bestWin: RecapRace | null;
  closest: RecapRace | null;
  firstWin: RecapRace | null;
  rival: RecapRival | null;
  /** Region codes where you won at least one race, with the count. */
  winsByRegion: Record<string, number>;
}

export interface RecapBillSummary {
  title: string;
  passed: boolean;
  year: number | null;
  for: number;
  against: number;
  abstain: number;
  yourVote: "for" | "against" | "abstain" | null;
}

export interface RecapLegislation {
  votesCast: number;
  votedFor: number;
  votedAgainst: number;
  abstained: number;
  /** Share of votes that matched your party's majority, 0-100; null under 5 comparable votes. */
  partyLoyaltyPct: number | null;
  /** Your most consequential sponsored bill (passed first, then biggest vote). */
  signature: RecapBillSummary | null;
  /** Bills whose outcome turned on a margin no larger than your own vote weight. */
  decisive: RecapBillSummary[];
}

export interface RecapWealthSeries {
  startTurn: number;
  binTurns: number;
  /** Net portfolio value per bin, home currency at the closing exchange rate. */
  points: number[];
  peak: { value: number; date: RecapGameDate } | null;
}

export interface RecapCorporation {
  name: string;
  ticker: string | null;
  turnsAsCeo: number;
  marketCap: number;
}

export interface RecapAward {
  title: string;
  scope: "world" | "country";
  rank: number;
  /** Display-ready value ("1,204 actions"). */
  detail: string;
}

export interface RecapPersona {
  key: string;
  title: string;
  reason: string;
}

/**
 * The season every recap shares: world totals computed once per reset and
 * embedded in each recap so a shared link renders without a second lookup.
 */
export interface RecapWorld {
  startYear: number;
  endYear: number;
  turns: number;
  players: number;
  countries: number;
  electionsHeld: number;
  billsPassed: number;
  conflicts: number;
  crises: number;
  /** The narrowest single-seat race any player stood in. */
  closestRace: { label: string; year: number | null; winner: string; marginVotes: number } | null;
}

/**
 * Frozen end-of-life snapshot of a character's season, computed at retirement
 * BEFORE the reset wipes actionLogs/bills/snapshots, then stored on the
 * RetiredCharacter doc (`recap`). Every stat group is nullable/zeroable so the
 * story UI can skip empty slides for a low-activity character.
 *
 * `schemaVersion` 2 added everything marked v2 below. Those fields are optional
 * so the 360 v1 recaps already on retired characters keep rendering; the story
 * gates each slide on its data, never on the version number.
 */
export interface CharacterRecap {
  schemaVersion: 1 | 2;
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

  // ── v2 ──────────────────────────────────────────────────────────────────
  countryName?: string;
  /** ISO currency code for money figures (v1 derived it client-side). */
  currency?: string;
  /** Display symbol for `currency` as the world's era showed it (1953 marks, not euros). */
  currencySymbol?: string;
  /** Party color, raw; the story lifts it for contrast via `recapAccent`. */
  partyColor?: string | null;
  arrived?: RecapGameDate;
  departed?: RecapGameDate;
  activity?: RecapActivity | null;
  climb?: RecapCareerStep[];
  marks?: RecapCareerMark[];
  races?: RecapRaces | null;
  legislation?: RecapLegislation | null;
  wealth?: RecapWealthSeries | null;
  corporation?: RecapCorporation | null;
  awards?: RecapAward[];
  persona?: RecapPersona | null;
  world?: RecapWorld | null;
}
