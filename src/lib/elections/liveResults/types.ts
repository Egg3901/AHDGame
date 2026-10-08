/**
 * Shared shapes for the live election results page (`/elections/[id]/results`)
 * and its polling endpoint (`GET /api/elections/[id]/results`).
 *
 * The endpoint is read-only and polled every 30s during active elections, so
 * this shape is deliberately smaller than the full `ElectionResponse` — just
 * what the results dashboard renders.
 */

export interface ResultsElectionMeta {
  id: string;
  countryId: string;
  electionType: string;
  state: string;
  status: string;
  cycle: number;
  electionYear: number | null;
  currentTurn: number;
  startTurn: number | null;
  endTurn: number | null;
  totalSeats: number;
  /** When votes represent a modeled indirect ballot rather than the public. */
  ballotLabel?: string;
  /** President only: EV majority threshold (floor(totalEv/2)+1). */
  evNeeded?: number;
  /** President only: total electoral votes in play. */
  totalEv?: number;
  /**
   * Final-hour drip window. Present while the election is in its last turn
   * interval and the turn clock is running; `progress` is the 0..1 fraction of
   * the final hour elapsed (wall clock), `endsAt` the scheduled resolution
   * moment. Every viewer sees the same drip because it is computed server-side.
   */
  finalHour?: {
    progress: number;
    endsAt: string;
  } | null;
  /**
   * US presidential races only, and only inside the final-hour window: the
   * election-night broadcast state (poll-closing schedule, called EV, event
   * feed). Null/absent everywhere else.
   */
  night?: PresidentialNight | null;
}

/**
 * Per-state broadcast status.
 * - polls_open: polls have not closed yet; grey, 0% reporting.
 * - counting: polls closed, no meaningful returns yet; no leader shown.
 * - too_early: first returns in but below the leader floor; no leader shown.
 * - leaning: a leader is shown (lean colour) but the state is not called.
 * - too_close: counted margin inside the small-margin band; leader shown, no call.
 * - called: the leader cannot be overtaken by the remaining final turn.
 */
export type PresidentialNightStatus =
  "polls_open" | "counting" | "too_early" | "leaning" | "too_close" | "called";

export interface PresidentialNightEvent {
  /** ISO instant inside the final-hour window. */
  at: string;
  stateId: string;
  /** Set on "call" events: the candidate the state was called for. */
  candidateId?: string;
  kind: "polls_close" | "call";
}

export interface PresidentialNight {
  /** Final-hour window bounds (ISO). */
  windowStart: string;
  windowEnd: string;
  /** Era-correct electoral college size and majority threshold. */
  totalEv: number;
  evNeeded: number;
  /** Candidate id -> EV from CALLED states only (news style). */
  calledEv: Record<string, number>;
  statesCalled: number;
  totalStates: number;
  statesPollsClosed: number;
  /** Next poll closing batch after `now`, or null once every state has closed. */
  nextClose: { at: string; stateIds: string[] } | null;
  /** Poll closings and calls up to `now`, oldest first. Same history for every viewer. */
  feed: PresidentialNightEvent[];
}

export interface ResultsCandidate {
  id: string;
  name: string;
  party: string;
  partyName: string;
  partyColor: string;
  isNPP: boolean;
  totalVotes: number;
  voteSharePct: number;
  /** President only: EV from units called so far (or final EV when resolved). */
  electoralVotes?: number;
  /** President only: EV where this candidate currently leads uncalled units. */
  leadingElectoralVotes?: number;
  /** Multi-seat races only: Hamilton seat projection. */
  seatsProjected?: number;
}

export interface ResultsUnitCandidate {
  candidateId: string;
  votes: number;
  voteShare: number;
}

export interface ResultsUnit {
  id: string;
  name: string;
  /** President: unit EV weight. Multi-seat: region seat count. */
  weight: number;
  totalVotes: number;
  /** 0-100. Turn-based estimate, ramped to 100 across the final-hour drip. */
  reportingPct: number;
  called: boolean;
  calledFor?: string;
  leaderId?: string;
  tied: boolean;
  leaderMargin: number;
  leaderMarginPct: number;
  candidates: ResultsUnitCandidate[];
  /** Presidential night only: when this state's polls close (ISO, inside the final hour). */
  pollsCloseAt?: string;
  /** Presidential night only: broadcast status for this state. */
  nightStatus?: PresidentialNightStatus;
}

export interface ResultsSummary {
  totalVotes: number;
  unitsReporting: number;
  totalUnits: number;
  unitsCalled: number;
  /** Candidate id — set only once decisive (EV majority / final). */
  projectedWinner?: string | null;
}

/** One sibling region election in a national parliamentary aggregation. */
export interface NationalRegion {
  electionId: string;
  name: string;
  seats: number;
  /** False until the region's final-hour reveal offset passes (drip). */
  declared: boolean;
  /** Party sequentialId → projected seats in this region. */
  seatsByParty: Record<string, number>;
}

export interface NationalParty {
  party: string;
  name: string;
  abbreviation: string;
  color: string;
  /** Seats from declared regions only. */
  declaredSeats: number;
  /** Full projection across all regions (declared or not). */
  projectedSeats: number;
}

export interface NationalProjection {
  kind: "majority" | "hung" | "largest" | "tooEarly";
  partyId?: string;
  partyName?: string;
  /** Seats past the majority line (majority) or seat lead (largest). */
  margin?: number;
}

/**
 * Country-wide seat aggregation across sibling region elections of the same
 * type + cycle (commons, shugiin, bundestag, npcDelegate, …). `style`
 * controls the projection copy: "westminster" gets the majority/hung-
 * parliament call, "generic" gets largest-party phrasing.
 */
export interface NationalResults {
  style: "westminster" | "generic";
  chamberLabel: string;
  totalSeats: number;
  majorityThreshold: number;
  regionsDeclared: number;
  totalRegions: number;
  parties: NationalParty[];
  regions: NationalRegion[];
  projection: NationalProjection;
}

export interface ElectionResultsResponse {
  election: ResultsElectionMeta;
  candidates: ResultsCandidate[];
  units: ResultsUnit[];
  national: NationalResults | null;
  summary: ResultsSummary;
  /** Viewer is an admin — unlocks the simulation controls client-side. */
  isAdmin: boolean;
  lastUpdated: string;
  /** Set on simulated frames generated client-side; never set by the API. */
  simulated?: boolean;
}
