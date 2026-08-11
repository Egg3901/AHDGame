import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Endorsement issued from the head-of-government's office (President / PM /
 * Chancellor) for a sub-presidential race. Parallel to GovernorEndorsement
 * but without a stateId on the endorser (the executive isn't state-bound).
 * The endorsement records the targeted race's stateId for display + filtering.
 *
 * Collection: "executiveEndorsements"
 */
export interface ExecutiveEndorsement {
  _id?: ObjectId;
  countryId: CountryId;
  /** Endorsed race's state — for UI filtering and audit. Allowed to be the
   *  national pseudo-stateId for races without a regional component. */
  targetStateId: string;
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
  withdrawnReason?: "manual" | "election_ended" | "candidate_inactive" | "leader_left_office";
}
