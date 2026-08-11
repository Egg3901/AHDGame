import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

export type NationalPartyElectionStatus = "voting" | "completed" | "cancelled";
export type NationalPartyElectionPosition = "chair" | "viceChair" | "treasurer";

export interface NationalPartyElection {
  _id: ObjectId;
  partyId: string;
  /** Country ID to distinguish parties with the same sequentialId across countries */
  countryId: CountryId;
  position: NationalPartyElectionPosition;
  status: NationalPartyElectionStatus;
  startTime: Date;
  endTime: Date;
  startTurn: number;
  endTurn: number;
  durationTurns: number;
  winnerId: ObjectId | null;
  /**
   * Marks the accelerated 12-turn chair election spawned per party while the
   * live pre-iteration founding phase is active. Founding elections waive the
   * 24h new-character cooldown and the party-tenure gate for entry and voting,
   * so brand-new players can seat their first chair at iteration start.
   */
  founding?: boolean;
  /**
   * Turn on which quorum acceleration was applied — when >50% of party
   * members had voted AND the chair seat was vacant, the remaining election
   * timer was halved. Set exactly once per election; prevents re-halving.
   * Never applied on a party's first completed-chair cycle (ticket #1023).
   * Undefined when acceleration never triggered.
   */
  quorumAcceleratedAtTurn?: number;
  /**
   * The pre-acceleration `endTurn` — the turn this election would naturally
   * have ended on. Recorded only when quorum acceleration shortens the timer.
   * `createMissingNationalElections` uses it to defer recreating this position
   * until the natural cycle end, so the accelerated chair re-syncs with
   * viceChair/treasurer instead of drifting permanently ahead.
   */
  originalEndTurn?: number;
  cancelledById?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface NationalPartyVote {
  _id: ObjectId;
  electionId: ObjectId;
  voterId: ObjectId;
  candidateId: ObjectId;
  votedAt: Date;
  /** Voter's partyInfluence at vote time — stored when leadershipElectionMethod is "influence" */
  voterPartyInfluence?: number;
}

export interface NationalPartyCandidate {
  _id: ObjectId;
  electionId: ObjectId;
  characterId: ObjectId;
  characterName: string;
  partyId?: string;
  countryId?: CountryId;
  position: NationalPartyElectionPosition;
  enteredAt: Date;
  withdrawnAt?: Date;
  /** Set when the parent election resolves and the candidacy is terminalized. */
  resolvedAt?: Date;
  // "withdrawn" = the player chose to leave; "completed" = the election concluded.
  status: "active" | "withdrawn" | "completed";
}
