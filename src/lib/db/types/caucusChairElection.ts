import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

export type CaucusChairElectionStatus = "voting" | "completed" | "cancelled";

/**
 * Rolling caucus-chair election. Caucuses are national-party-only, so their
 * election cadence is anchored to the parent party's national chair election.
 */
export interface CaucusChairElection {
  _id: ObjectId;
  caucusId: ObjectId;
  partyId: string;
  countryId: CountryId;
  status: CaucusChairElectionStatus;
  startTime: Date;
  endTime: Date;
  startTurn: number;
  endTurn: number;
  durationTurns: number;
  winnerId: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CaucusChairCandidate {
  _id: ObjectId;
  electionId: ObjectId;
  caucusId: ObjectId;
  characterId: ObjectId;
  characterName: string;
  status: "active" | "withdrawn";
  enteredAt: Date;
  withdrawnAt?: Date | null;
}

export interface CaucusChairVote {
  _id: ObjectId;
  electionId: ObjectId;
  caucusId: ObjectId;
  voterId: ObjectId;
  candidateId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
