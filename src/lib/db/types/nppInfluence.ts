import type { ObjectId } from "mongodb";

export type InfluenceType =
  | "boost_favorability"
  | "boost_influence"
  | "boost_loyalty"
  | "reduce_stubbornness"
  | "relocate_state"
  | "endorse_candidate"
  | "withdraw_election"
  | "oppose_candidate"
  | "support_leadership";

export type InfluenceOutcome = "success" | "failure" | "backfire";

export interface NPPInfluenceAttempt {
  _id: ObjectId;
  characterId: ObjectId;
  nppId: ObjectId;
  influenceType: InfluenceType;
  actionCost: number;
  fundCost: number;
  context: {
    electionId?: ObjectId;
    candidateId?: ObjectId;
    targetStateId?: string;
    candidateName?: string;
  };
  calculation: {
    baseChance: number;
    stubbornnessPenalty: number;
    partyBonus: number;
    politicalInfluenceBonus: number;
    favorabilityBonus: number;
    fundBonus: number;
    relationshipBonus: number;
    finalChance: number;
    roll: number;
  };
  outcome: InfluenceOutcome;
  resultMessage: string;
  turn: number;
  partyInfluence?: {
    type: "state" | "national";
    partyId: string;
    stateId: string;
  };
  createdAt: Date;
}

export interface NPPRelationship {
  _id: string;
  characterId: ObjectId;
  nppId: ObjectId;
  relationshipScore: number;
  totalAttempts: number;
  successfulAttempts: number;
  lastAttemptTurn: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NPPEndorsementSource = "organic" | "arranged";
export type NPPEndorsementPhase = "primary" | "general";
export type NPPEndorsementWithdrawalReason =
  | "switched"
  | "candidate_inactive"
  | "election_ended"
  | "relevance_lost"
  | "country_mismatch"
  | "score_drop"
  | "manual_only";

export interface NPPEndorsement {
  _id: ObjectId;
  nppId: ObjectId;
  nppName: string;
  electionId: ObjectId;
  candidateId: ObjectId;
  candidateName: string;
  candidateIsNPP: boolean;
  source?: NPPEndorsementSource;
  arrangedBy?: ObjectId;
  arrangedByParty?: string;
  score?: number;
  candidateCountAtDecision?: number;
  electionPhaseAtDecision?: NPPEndorsementPhase;
  lastEvaluatedTurn?: number;
  reevaluateAfterTurn?: number;
  isActive: boolean;
  createdAt: Date;
  withdrawnAt?: Date;
  withdrawnReason?: NPPEndorsementWithdrawalReason;
}

export interface PlayerEndorsement {
  _id: ObjectId;
  characterId: ObjectId;
  characterName: string;
  electionId: ObjectId;
  candidateId: ObjectId;
  candidateName: string;
  isActive: boolean;
  createdAt: Date;
  withdrawnAt?: Date;
}
