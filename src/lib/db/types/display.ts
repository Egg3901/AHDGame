export interface CandidateDisplay {
  id: string;
  characterId: string;
  characterName: string;
  avatarUrl?: string;
  party: string;
  partyName?: string;
  partyColor?: string;
  enteredAt?: string;
  isNPP?: boolean;
  nppId?: string;
  endorsements?: { nppId: string; nppName: string }[];
}

export interface ElectionPolling {
  leaderId: string | null;
  leaderName: string | null;
  leaderParty: string | null;
  sharesPct: Record<string, number>;
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  candidatePartyNames?: Record<string, string>;
  candidatePartyColors?: Record<string, string>;
  source: "general" | "primary" | null;
}

export interface ElectionDisplay {
  id: string;
  seatId?: string;
  electionType:
    | "senate"
    | "house"
    | "stateSenate"
    | "governor"
    | "president"
    | "commons"
    | "primeMinister"
    | (string & {});
  state: string;
  countryId: string;
  senateClass?: number;
  chamberClass?: number;
  cycle: number;
  /** LARP calendar year baked at spawn; absent on legacy rows. */
  electionYear?: number;
  status: string;
  totalSeats?: number;
  candidates: CandidateDisplay[];
  startTime?: string;
  endTime?: string;
  primaryEndTime?: string;
  // Turn-based deadlines — preferred over the timestamps for countdown timers
  // (freeze on pause, no wall-clock drift). Absent on legacy rows; timers fall
  // back to the timestamp fields when these are missing.
  startTurn?: number;
  endTurn?: number;
  primaryEndTurn?: number;
  durationHours?: number;
  primaryDurationHours?: number;
  inPrimary?: boolean;
  polling?: ElectionPolling;
  seatsEstimate?: Record<string, number>;
  /** Current officeholder for single-seat races. Null/absent for multi-seat races. */
  incumbent?: { name: string; party: string; partyColor?: string } | null;
  /** General phase tally data for vote table display */
  generalTally?: {
    totalVotes: Record<string, number>;
    turnSnapshots: {
      turn: number;
      sharesPct: Record<string, number>;
      cumulativeVotes: Record<string, number>;
      seatsEstimate?: Record<string, number>;
    }[];
  };
}

export interface CharacterBasic {
  _id: string;
  name: string;
  party: string;
  homeState: string;
  countryId?: string;
  /**
   * When set, the character has an active candidacy in a non-terminal election
   * (includes `completed` races awaiting resolution — same rules as enter-route blocking).
   */
  activeElection?: {
    id: string;
    seatId?: string;
    electionType: string;
    state: string;
    cycle: number;
  } | null;
}

export interface GameStateDisplay {
  isActive: boolean;
  pausedAt: string | null;
  /** Game time (lastTurnProcessed) — use for timer display so 1 turn = 1h countdown */
  lastTurnProcessed?: string | null;
  /** Current game year (e.g. 2020, 2022). Use with lastTurnProcessed to compute election years. */
  currentYear?: number;
  /** Current game turn (1-based). Use with lastTurnProcessed for accurate election year labels. */
  currentTurn?: number;
}
