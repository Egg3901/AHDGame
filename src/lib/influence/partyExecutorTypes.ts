import type { ObjectId } from "mongodb";
import type { InfluenceType } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

export interface ExecutePartyInfluenceInput {
  partyId: string;
  partyObjectId?: ObjectId;
  countryId?: CountryId;
  stateId?: string;
  nppId: ObjectId;
  influenceType: InfluenceType;
  fundAmount: number;
  actorCharacterId: ObjectId;
  context: {
    electionId?: string;
    candidateId?: string;
    targetStateId?: string;
  };
}
