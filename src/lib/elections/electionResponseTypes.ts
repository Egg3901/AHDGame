import type {
  ElectionCandidate,
  Character,
  NPP,
  PoliticalParty,
  NPPEndorsement,
  PlayerEndorsement,
  PrimarySnapshot,
  Campaign,
  StatePartyOrg,
  ElectionVoteTally,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type {
  ContingentElectionDisplay,
  PresidentialResolutionMode,
} from "@/lib/elections/presidentialResolutionDisplay";
import type { EnrichedCandidate, PartyGroup } from "@/lib/elections/candidateEnrichment";
import type { FactorLedgerSnapshot } from "@/lib/electionEngine/factorLedger";

export interface PollingData {
  leaderId: string | null;
  leaderName: string | null;
  leaderParty: string | null;
  sharesPct: Record<string, number>;
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  candidatePartyNames: Record<string, string>;
  candidatePartyColors: Record<string, string>;
  source: "general" | "primary" | null;
}

export interface SnapshotEntry {
  recordedAt: Date;
  byParty: PrimarySnapshot["byParty"];
}

export interface GeneralVotesData {
  totalVotes: Record<string, number>;
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  /**
   * Hex colour per candidate, resolved server-side from the party referenced by
   * candidateParties. Needed because candidateParties stores country-scoped
   * sequentialId strings (e.g. "1", "2") that the client has no way to map
   * to party hex colours without a party lookup.
   */
  candidateColors: Record<string, string>;
  finalized: boolean;
  seatsEstimate: Record<string, number> | null;
  turnSnapshots: Array<{
    turn: number;
    recordedAt: Date;
    cumulativeVotes: Record<string, number>;
    sharesPct: Record<string, number>;
    seatsEstimate?: Record<string, number>;
  }>;
  // Electoral-vote fields (president only) — shape comes from electoralVoteService
  electoralVotesByCandidate?: Record<string, number>;
  electoralMapData?: Record<string, { color: string; label: string; tooltip: string[] }>;
  stateVoteData?: Record<
    string,
    { votesByCandidate: Record<string, number>; evByCandidate: Record<string, number> }
  >;
  /** President only: total electoral votes per state for the active preset (1990 vs 2020 census). */
  evByState?: Record<string, number>;
  evByTurn?: Array<{ turn: number; electoralVotesByCandidate: Record<string, number> }>;
  stateVotesOverTime?: Record<
    string,
    Array<{
      turn: number;
      recordedAt: Date;
      cumulativeVotes: Record<string, number>;
      sharesPct: Record<string, number>;
    }>
  >;
  /** President only: how the race was resolved when finalized */
  resolutionMode?: PresidentialResolutionMode;
  /** President only: House/Senate contingent breakdown when no EV majority */
  contingentResult?: ContingentElectionDisplay;
  /** President only: contingent ballot failed and will retry next turn */
  contingentResolutionPending?: boolean;
  /** President only: tally finalized but executive seating incomplete */
  executiveSeatingPending?: boolean;
}

export interface GameStateData {
  isActive: boolean;
  pausedAt: Date | null;
  lastTurnProcessed: Date | null;
  currentTurn: number;
  effectiveNow: string;
  /** When true, US House primaries advance top-3 (districted nominee split). */
  redistrictingEnabled?: boolean;
}

export interface ElectionResponse {
  // Identity
  id: string;
  seatId: string | null;
  electionType: string;
  state: string;
  countryId: string;
  senateClass: number | null;
  chamberClass: number | null;
  cycle: number;
  /**
   * LARP calendar year baked at spawn time from the preset's canonical anchors.
   * Null on legacy/un-backfilled rows; display sites fall back to
   * `electionToLarpYear(...)` with the active gameState ctx.
   */
  electionYear: number | null;
  status: string;
  totalSeats: number | null;

  // Timing
  startTime: Date | string | null;
  endTime: Date | string | null;
  primaryEndTime: Date | string | null;
  // Turn-based deadlines — preferred over the timestamps for countdowns. The
  // turn counter freezes on pause and does not drift when the cron falls behind
  // wall-clock, so display surfaces should count down (targetTurn - currentTurn)
  // rather than (deadline - now). Null on legacy/un-backfilled rows.
  startTurn: number | null;
  endTurn: number | null;
  primaryEndTurn: number | null;
  durationHours: number | null;
  primaryDurationHours: number | null;

  // Phase
  inPrimary: boolean;
  isEnded: boolean;
  isUpcoming: boolean;
  inGeneral: boolean;

  /**
   * How many candidates advance per party from this race's primary, resolved
   * server-side against the world's live redistricting flag (US=1, UK/JP=3,
   * one-party states=7, US House=3 when redistricting is on; single-winner
   * executive races always 1).
   *
   * Display surfaces MUST read this rather than recomputing the cap — a client
   * component has no access to gameState, so its own call would fall back to
   * the legacy cap and disagree with what the turn resolver enforced
   * (ticket-1041).
   */
  primaryAdvanceCount: number;

  // Core data (always present)
  candidates: EnrichedCandidate[];
  byParty: PartyGroup[];
  polling: PollingData | null;
  /** Seat estimates for multi-seat races (house/stateSenate/commons/regionalCouncil). Always computed. */
  seatsEstimate: Record<string, number> | null;

  /** Current officeholder for single-seat races (senate, governor, president, primeMinister). Null for multi-seat races. */
  incumbent: { name: string; party: string; partyColor: string | null } | null;

  // Full view only (null in summary)
  prevElectionId: string | null;
  nextElectionId: string | null;
  allCandidates: EnrichedCandidate[] | null;
  snapshotHistory: SnapshotEntry[] | null;
  generalVotes: GeneralVotesData | null;
  myCharId: string | null;
  myEndorsedCandidateId: string | null;
  isAdmin: boolean;
  gameState: GameStateData | null;

  /**
   * Phase B follow-up — per-party spend-this-turn aggregate for the
   * race, sourced from each campaign's `spendThisTurn` accumulator.
   * Populated for general-phase elections only.
   */
  fundsByParty?: Record<string, number>;

  /**
   * Phase B follow-up — per-party prior-cycle seat-share for the race
   * (0..1). Populated for general-phase elections only.
   */
  incumbentSeatShareByParty?: Record<string, number>;

  /**
   * Per-party registration percentage (0..100) for the race's state, from
   * `statePartyOrg.registration`. Lets the PersuasionDrivers card scale
   * driver rows by the engine's effective peelable fraction. State-scoped
   * general-phase elections only.
   */
  persuasionRegByParty?: Record<string, number>;

  /**
   * Single-winner executive own-race only: the sitting executive's party id
   * and approval (0..100), used to render the approval-scaled Incumbency row.
   * Populated for general-phase Governor / President own-races only.
   */
  incumbentPartyId?: string;
  incumbentApproval?: number;
  /**
   * Single-seat legislative own-race (US Senate): sitting senator's party and
   * consecutive terms, feeding the card's flat incumbency shield. Populated
   * only when the incumbent is running (open seats omit). Not fog-sensitive.
   */
  legislativeIncumbentPartyId?: string;
  legislativeIncumbentTenureTerms?: number;

  /**
   * Median voter `(ep, sp)` consumed by the PersuasionDrivers card's
   * policy-distance driver. Populated for general-phase elections only.
   *
   * Server-computed so per-state demographics never reach the client:
   *   - **State-scoped races** (US House, Senate, Governor, etc.): the
   *     election's own state's turnout-weighted median.
   *   - **US presidential**: EV-weighted average of all US states'
   *     medians — campaigns court the EV map, so a 55-EV state pulls
   *     the signal 55× harder than a 3-EV one.
   *
   * Undefined for races without a clean state scope (e.g. open national
   * head-of-government races outside the US) — the card falls back to
   * the engine's `(0, 0)` neutrality.
   */
  medianVoter?: { ep: number; sp: number };

  /**
   * Per-party presidential coattail percentage tilt (presidentialModifier − 1,
   * ×100) for the Presidential Popularity row — the sitting President's party at
   * its national-approval-driven multiplier. General-phase non-presidential races.
   */
  presidentialCoattailPctByParty?: Record<string, number>;

  /**
   * Per-party gubernatorial coattail percentage tilt (govModifier − 1, ×100),
   * for the Gubernatorial Coattails row. Eligible down-ballot generals.
   */
  gubernatorialCoattailPctByParty?: Record<string, number>;

  /** Per-party +5% nominal-share tilt for eligible UK regional midterms. */
  midtermOppositionBoostPctByParty?: Record<string, number>;

  /**
   * President only: the economic-referendum reading the engine recorded on the
   * race's vote tally (`ElectionVoteTally.economicReferendum`). Read straight
   * off the tally and passed through, never recomputed here, so the National
   * Mood gauge shows exactly the shift the engine applied. Absent for races
   * that ran before the channel existed, and for non-presidential races.
   */
  economicReferendum?: {
    miseryIndex: number;
    /** Signed share shift for the incumbent party, in points. */
    sharePts: number;
    components: Array<{ key: string; label: string; contributionPts: number }>;
    /** Penalty-side multiplier for consecutive terms held. 1 when it does not apply. */
    fatigueMultiplier: number;
    /**
     * Share of the raw penalty forgiven by credit-for-response, in [0, 0.4].
     * Absent when no enacted bill qualified.
     */
    forgivenessFrac?: number;
    /** The bills that earned the forgiveness. */
    creditedBills?: Array<{ key: string; title: string; component: string; weight: number }>;
    incumbentPartyId?: string;
    /** Resolved display name for `incumbentPartyId`, when the party is known. */
    incumbentPartyName?: string;
    incumbentPartyColor?: string;
    recordedTurn: number;
  };

  /**
   * President only: the descriptive factor ledger read straight off the vote
   * tally (`ElectionVoteTally.factorLedger`), never recomputed here. Feeds the
   * Factor Ledger card. Fog-of-war applied in `enrichElection`: the national
   * factor waterfall is shown for every candidate, but per-candidate
   * `bucketAppeal` and the per-unit breakdown are stripped for candidates the
   * viewer does not own. Absent for races that ran before the ledger existed.
   */
  factorLedger?: FactorLedgerSnapshot;

  /**
   * Per-state registration-lean breakdown for the presidential
   * RegistrationInfluenceCard. Keyed by stateId → party shares (each
   * party's `statePartyOrg.registration` as a lean %) plus the
   * `independent` / `unregistered` pool buckets. Populated for the US
   * presidential full view only; states without registration data are
   * omitted so the card shows its honest "no data tracked" placeholder.
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
   * (the party's `sequentialId` as a string), used to render the
   * `regByState` breakdown. Populated alongside `regByState`.
   */
  partyDisplayById?: Record<string, { abbr: string; color: string }>;
}

export interface ResolveElectionOptions {
  /** "full" returns tally, nav, snapshots, and user-specific fields. "summary" omits them. */
  view: "full" | "summary";
  /** Authenticated user ID string (ObjectId hex). Null for unauthenticated requests. */
  userId: string | null;
  /** Whether the requesting user is an admin. Ignored in summary mode. */
  isAdmin?: boolean;
  /**
   * Active character ID (ObjectId hex) for this request. Multi-profile aware —
   * takes precedence over userId-based character lookup so the "isYou" flag
   * reflects the user's active character instead of an arbitrary one from findOne.
   */
  activeCharacterId?: string | null;
}

// ---------------------------------------------------------------------------
// Internal types for pre-fetched dependency bundles
// ---------------------------------------------------------------------------

/** Full dependency set used by _enrichElection() for both views. */
export interface ElectionDeps {
  candidates: ElectionCandidate[];
  characters: Character[];
  npps: NPP[];
  parties: PoliticalParty[];
  // Full-view only (empty arrays / null in summary mode)
  nppEndorsements: NPPEndorsement[];
  playerEndorsements: PlayerEndorsement[];
  snapshots: PrimarySnapshot[];
  statePartyOrgs: StatePartyOrg[];
  campaigns: Campaign[];
  // Tally (for polling in summary; for full data in full mode)
  tally: ElectionVoteTally | null;
  // Latest primary snapshot per election (for polling in summary mode)
  latestPrimarySnapshot: PrimarySnapshot | null;
  /** Current officeholder for single-seat races. Null for multi-seat or no holder. */
  incumbent: { name: string; partyId: string } | null;
}

// ---------------------------------------------------------------------------
// /api/elections/composition response types
// ---------------------------------------------------------------------------

export interface PartySeats {
  party: string;
  partyName: string;
  partyColor: string;
  seats: number;
  /** -5 (far left) → +5 (far right), null for vacant */
  economicPosition: number | null;
  /** Country ID for party logo lookup */
  countryId?: CountryId;
}

/** One chamber's seat breakdown, current and projected. */
export interface ChamberCompositionData {
  /** Chamber key from the country's legislature config, e.g. "commons". */
  key: string;
  /** Display name, e.g. "House of Commons". */
  name: string;
  /** Seat total from config, NOT a hardcoded number. */
  totalSeats: number;
  current: PartySeats[];
  projected: PartySeats[];
  /** True when at least one seat in this chamber is in its general phase. */
  inGeneral: boolean;
}

/**
 * Chamber-neutral so every country gets a real composition panel.
 *
 * The previous shape was `currentHouse`/`currentSenate` with the frontend
 * dividing by a hardcoded 435/100, and the route hardcoded `countryId: "US"`.
 * Any non-US country that filtered to a chamber race was shown US numbers.
 */
export interface CompositionResponse {
  countryId: CountryId;
  /** Null when the country has no elected chamber of that tier. */
  lower: ChamberCompositionData | null;
  /** Null for a unicameral legislature or an appointed upper chamber. */
  upper: ChamberCompositionData | null;
  /** Contested class for a classed upper chamber (US Senate), else null. */
  activeUpperClass: number | null;
}

// ---------------------------------------------------------------------------
// /api/admin/elections/log response types
// ---------------------------------------------------------------------------

export interface PrimaryPartyResult {
  party: string;
  partyName: string;
  partyColor: string;
  countryId: "US" | "UK" | "DE";
  candidates: {
    candidateId: string;
    name: string;
    score: number; // final primary score (0–100)
    sharePct: number; // % of party primary
    advanced: boolean; // true = advanced to general
  }[];
  /** Human-readable event lines, e.g.
   *  "Alice Smith advanced to general (62.4%)"
   *  "Bob Jones eliminated (37.6%)" */
  events: string[];
}

export interface GeneralCandidateResult {
  candidateId: string;
  name: string;
  party: string;
  partyName: string;
  partyColor: string;
  countryId: "US" | "UK" | "DE";
  votes: number;
  pct: number;
  seats: number | null; // null for single-winner races
  won: boolean;
}

export interface ElectionLogEntry {
  id: string;
  electionType: string;
  state: string;
  stateName: string;
  countryId: "US" | "UK" | "DE";
  senateClass: number | null;
  cycle: number;
  status: string;
  totalSeats: number | null;
  startTime: string | null;
  endTime: string | null;
  primaryEndTime: string | null;
  /** Per-party primary breakdown (empty for single-candidate primaries) */
  primaryResults: PrimaryPartyResult[];
  /** General election results (null if election hasn't reached general yet) */
  generalResult: {
    totalVotes: number;
    turnsCounted: number;
    finalized: boolean;
    candidates: GeneralCandidateResult[];
    /** Human-readable event lines */
    events: string[];
    /** President only */
    resolutionMode?: PresidentialResolutionMode;
    contingentResult?: ContingentElectionDisplay;
    electoralVotesByCandidate?: Record<string, number>;
  } | null;
}
