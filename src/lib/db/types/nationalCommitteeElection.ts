import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

export type NationalCommitteeElectionStatus = "voting" | "completed" | "cancelled";

export interface NationalCommitteeElection {
  _id: ObjectId;
  partyId: string;
  /** Country ID to distinguish parties with the same sequentialId across countries */
  countryId: CountryId;
  status: NationalCommitteeElectionStatus;
  startTime: Date;
  endTime: Date;
  startTurn: number;
  endTurn: number;
  durationTurns: number;
  winnerIds: ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NationalCommitteeVote {
  _id: ObjectId;
  electionId: ObjectId;
  voterId: ObjectId;
  candidateIds: ObjectId[];
  votedAt: Date;
}

export interface NationalCommitteeCandidate {
  _id: ObjectId;
  electionId: ObjectId;
  characterId: ObjectId;
  characterName: string;
  partyId?: string;
  countryId?: CountryId;
  enteredAt: Date;
  withdrawnAt?: Date;
  /** Set when the parent election resolves and the candidacy is terminalized. */
  resolvedAt?: Date;
  // "withdrawn" = the player chose to leave; "completed" = the election concluded.
  status: "active" | "withdrawn" | "completed";
}
