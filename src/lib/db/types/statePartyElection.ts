import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

export type StatePartyElectionStatus = "voting" | "completed" | "cancelled";
export type StatePartyElectionPosition = "chair" | "viceChair" | "treasurer";

export interface StatePartyElection {
  _id: ObjectId;
  stateId: string;
  partyId: string;
  /** Country ID to distinguish state parties across countries */
  countryId?: CountryId;
  position: StatePartyElectionPosition;
  status: StatePartyElectionStatus;
  startTime: Date;
  endTime: Date;
  startTurn: number;
  endTurn: number;
  durationTurns: number;
  winnerId: ObjectId | null;
  /**
   * Marks an accelerated leadership election spawned while the live
   * pre-iteration founding phase is active. Founding elections waive the
   * 24h new-character cooldown and the party-tenure / relocation gates for
   * entry and voting, so brand-new players can seat state leadership at
   * iteration start (mirrors {@link NationalPartyElection.founding}).
   */
  founding?: boolean;
  cancelledById?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface StatePartyVote {
  _id: ObjectId;
  electionId: ObjectId;
  voterId: ObjectId;
  candidateId: ObjectId;
  votedAt: Date;
}

export interface StatePartyCandidate {
  _id: ObjectId;
  electionId: ObjectId;
  characterId: ObjectId;
  characterName: string;
  stateId?: string;
  partyId?: string;
  countryId?: CountryId;
  position: StatePartyElectionPosition;
  enteredAt: Date;
  withdrawnAt?: Date;
  /** Set when the parent election resolves and the candidacy is terminalized. */
  resolvedAt?: Date;
  // "withdrawn" = the player chose to leave; "completed" = the election concluded.
  status: "active" | "withdrawn" | "completed";
}
