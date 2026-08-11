import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/** Collection: "governorEndorsements" */
export interface GovernorEndorsement {
  _id?: ObjectId;
  countryId: CountryId;
  stateId: string;
  endorsedByCharacterId: ObjectId;
  endorsedByName: string;
  electionId: ObjectId;
  candidateId: ObjectId;
  candidateName: string;
  candidateIsNPP: boolean;
  candidatePartyId?: string;
  isActive: boolean;
  createdAtTurn: number;
  createdAt: Date;
  withdrawnAt?: Date;
  withdrawnReason?: "manual" | "election_ended" | "candidate_inactive" | "governor_left_office";
}
