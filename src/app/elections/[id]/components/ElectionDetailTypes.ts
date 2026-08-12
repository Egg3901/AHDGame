import type { CountryId } from "@/lib/constants/countries";
import type {
  ContingentElectionDisplay,
  PresidentialResolutionMode,
} from "@/lib/elections/presidentialResolutionDisplay";

export interface Endorsement {
  nppId?: string;
  nppName?: string;
  characterId?: string;
  characterName?: string;
  type: "npp" | "player";
}

export interface CandidateDetail {
  id: string;
  characterId: string;
  characterName: string;
  avatarUrl?: string;
  party: string;
  partyName: string;
  partyColor: string;
  partyEcon: number;
  partySocial: number;
  isNPP: boolean;
  nppId: string | null;
  economicPosition: number;
  socialPosition: number;
  favorability: number;
  politicalInfluence: number;
  nationalInfluence: number;
  primaryScore: number;
  sharePct: number;
  enteredAt: string;
  endorsements: Endorsement[];
  isYou: boolean;
  /** President: running mate profile/display ID (sequentialId when available) */
  runningMateId?: string | null;
  /** President: running mate character ObjectId for write actions like the picker modal */
  runningMateCharacterId?: string | null;
  /** President: running mate name */
  runningMateName?: string | null;
  /** Campaign ID if a campaign exists for this candidate */
  campaignId?: string | null;
  /** Campaign cash on hand (funds) */
  campaignFunds?: number | null;
  /** Optional candidate-selected primary display color */
  campaignColor?: string | null;
  /** Presidential campaign strength (cumulative contributor boosts) */
  campaignStrength?: number | null;
  /** Presidential races: state the candidate is currently campaigning in */
  travelState?: string | null;
  /** Presidential general: nominee suspended active campaigning. */
  campaignSuspended?: boolean;
  endorsedCandidateName?: string | null;
  endorsementTargetWithdrawn?: boolean;
  /**
   * Phase B Support score (0..100). Server-side fog-of-war: populated
   * only for privileged viewers (admin OR viewer has a candidate in the
   * race). Undefined for opposing-party viewers and unauthenticated
   * sessions — the PersuasionDrivers card's supportDelta driver row
   * falls back to neutral (0pts) in that case.
   */
  support?: number;
}

export interface PartyGroup {
  partyId: string;
  partyName: string;
  partyColor: string;
  countryId: CountryId;
  partyEcon: number;
  partySocial: number;
  hasCompetitivePrimary: boolean;
  candidates: CandidateDetail[];
}

export interface SnapshotEntry {
  candidateId: string;
  characterName: string;
  party: string;
  primaryScore: number;
  sharePct: number;
}

export interface SnapshotPoint {
  recordedAt: string;
  byParty: Record<string, SnapshotEntry[]>;
}

export interface VoteTurnSnapshot {
  turn: number;
  recordedAt: string;
  cumulativeVotes: Record<string, number>;
  sharesPct: Record<string, number>;
  /** Multi-seat general elections: projected seats at this turn (same method as `seatsEstimate`). */
  seatsEstimate?: Record<string, number>;
}

/** Per-state map data for presidential electoral map (stateId -> display data) */
export interface ElectoralMapState {
  color: string;
  label: string;
  tooltip: string[];
}

export interface GeneralVotes {
  totalVotes: Record<string, number>;
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  /** candidateId → party hex colour, resolved server-side from the countryId-scoped party lookup. */
  candidateColors: Record<string, string>;
  finalized: boolean;
  seatsEstimate: Record<string, number> | null;
  turnSnapshots: VoteTurnSnapshot[];
  /** President only: electoral votes per candidate */
  electoralVotesByCandidate?: Record<string, number>;
  /** President only: per-state map data for electoral map visualization */
  electoralMapData?: Record<string, ElectoralMapState>;
  /** President only: per-state vote/EV data for state detail modal */
  stateVoteData?: Record<
    string,
    { votesByCandidate: Record<string, number>; evByCandidate: Record<string, number> }
  >;
  /** President only: total electoral votes per state for the active preset (1990 vs 2020 census). */
  evByState?: Record<string, number>;
  /** President only: EV by turn for trend chart */
  evByTurn?: { turn: number; electoralVotesByCandidate: Record<string, number> }[];
  /** President only: per-state votes over time (stateId -> snapshots) */
  stateVotesOverTime?: Record<string, VoteTurnSnapshot[]>;
  /** President only: how the race was resolved when finalized */
  resolutionMode?: PresidentialResolutionMode;
  /** President only: House/Senate contingent breakdown when no EV majority */
  contingentResult?: ContingentElectionDisplay;
  /** President only: contingent ballot failed and will retry next turn */
  contingentResolutionPending?: boolean;
  /** President only: tally finalized but executive seating incomplete */
  executiveSeatingPending?: boolean;
}

export type ElectionType =
  | "senate"
  | "house"
  | "stateSenate"
  | "governor"
  | "president"
  | "commons"
  | "primeMinister"
  | "regionalCouncil"
  | "shugiin"
  | "sangiin"
  | "bundestag"
  | "landtag"
  | "ministerPresident"
  | "chancellor"
  | "npcDelegate"
  | "peoplesCongress"
  | "dail"
  | "seanad"
  | "uachtaran"
  | "localCouncil";

export interface ElectionDetail {
  id: string;
  seatId: string | null;
  electionType: ElectionType;
  state: string;
  countryId: string;
  senateClass: number | null;
  chamberClass: number | null;
  cycle: number;
  /** Baked LARP year (null on legacy/un-backfilled rows). */
  electionYear: number | null;
  prevElectionId?: string | null;
  nextElectionId?: string | null;
  status: string;
  totalSeats: number | null;
  startTime: string | null;
  endTime: string | null;
  primaryEndTime: string | null;
  // Turn-based deadlines — preferred for countdown timers (freeze on pause, no
  // wall-clock drift). Null on legacy rows; the timeline falls back to the
  // timestamp fields when these are absent.
  startTurn: number | null;
  endTurn: number | null;
  primaryEndTurn: number | null;
  durationHours: number | null;
  primaryDurationHours: number | null;
  inPrimary: boolean;
  isEnded: boolean;
  isUpcoming: boolean;
  inGeneral: boolean;
  byParty: PartyGroup[];
  allCandidates: CandidateDetail[];
  snapshotHistory: SnapshotPoint[];
  generalVotes: GeneralVotes | null;
  myCharId: string | null;
  myEndorsedCandidateId: string | null;
  isAdmin?: boolean;
  gameState: {
    isActive: boolean;
    pausedAt: string | null;
    lastTurnProcessed?: string | null;
    currentTurn?: number | null;
    /** When true, US House primaries advance top-3 (districted nominee split). */
    redistrictingEnabled?: boolean;
  } | null;

  /**
   * Phase B follow-up — per-party spend-this-turn aggregate for the
   * race, sourced from each campaign's `spendThisTurn` accumulator and
   * reset every turn-tick. Populated for general-phase elections only.
   * Fed to the PersuasionDrivers card's Money driver row. Not fog-
   * sensitive — campaign spend is publicly observable.
   */
  fundsByParty?: Record<string, number>;

  /**
   * Phase B follow-up — per-party prior-cycle seat-share for the race
   * (share of the seat pool the party held last cycle, 0..1). Sourced
   * from the most-recent resolved tally on the same seat key. Populated
   * for general-phase elections only. Fed to the PersuasionDrivers
   * card's Incumbency driver row. Not fog-sensitive.
   */
  incumbentSeatShareByParty?: Record<string, number>;

  /**
   * Per-party registration percentage (0..100) for the race's state, from
   * `statePartyOrg.registration`. Fed to the PersuasionDrivers card so its
   * driver rows scale by the engine's effective peelable fraction.
   * State-scoped general-phase elections only. Not fog-sensitive.
   */
  persuasionRegByParty?: Record<string, number>;

  /**
   * Single-winner executive own-race only: sitting executive's party + approval
   * (0..100). Fed to the PersuasionDrivers card's Incumbency row so it shows the
   * approval-scaled shield/drag. Populated for general-phase Governor/President
   * own-races only.
   */
  incumbentPartyId?: string;
  incumbentApproval?: number;

  /**
   * Single-seat legislative own-race (US Senate): sitting senator's party +
   * consecutive terms for the card's flat incumbency shield. General-phase
   * Senate races where the incumbent is running.
   */
  legislativeIncumbentPartyId?: string;
  legislativeIncumbentTenureTerms?: number;

  /**
   * M5 — server-computed median voter for the policy-distance driver.
   * State-scoped races: the seat's own state turnout-weighted median.
   * US presidential: EV-weighted average of all states' medians.
   * Populated for general-phase elections only. Fed to the
   * PersuasionDrivers card's Policy alignment driver row.
   */
  medianVoter?: { ep: number; sp: number };

  /**
   * Per-party presidential coattail percentage tilt (presidentialModifier − 1,
   * ×100) for the Presidential Coattails row — the sitting President's party at
   * its national-approval-driven multiplier. General-phase non-presidential races.
   */
  presidentialCoattailPctByParty?: Record<string, number>;

  /**
   * Per-party gubernatorial coattail percentage tilt (govModifier − 1, ×100),
   * for the Gubernatorial Coattails row. Eligible US down-ballot generals.
   */
  gubernatorialCoattailPctByParty?: Record<string, number>;

  /**
   * Per-state registration-lean breakdown for the presidential
   * RegistrationInfluenceCard (stateId → party shares + pool buckets).
   * Populated for the US presidential full view only. Fed to
   * `buildGeneralElectionViewModel`'s `regByState`.
   */
  regByState?: Record<
    string,
    {
      partyShares: { partyId: string; leanPct: number }[];
      independent?: number;
      unregistered?: number;
    }
  >;

  /**
   * Party display info (abbreviation + color) keyed by `partyId`
   * (sequentialId as a string), used to render `regByState`.
   */
  partyDisplayById?: Record<string, { abbr: string; color: string }>;
}
