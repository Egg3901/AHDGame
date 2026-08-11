import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";
import type { CurrencyCode } from "../../constants/currencies";
import type { LegalStructureId } from "../../constants/legalStructures";

export type CorporationVoteType =
  | "governance_change"
  | "dissolution"
  | "relocation"
  | "share_issuance"
  | "adopt_supershares"
  | "ticker_change";

export type CorporationVoteStatus = "open" | "passed" | "failed" | "cancelled";

export interface CorporationVoteCast {
  characterId?: ObjectId;
  imperialCharacterId?: ObjectId;
  corporationId?: ObjectId;
  /** Vote weight at cast time — share count, plus the supershare bonus for dual-class corps. */
  voteShares: number;
  vote: "yes" | "no";
  castAt: Date;
}

export interface CorporationVotePayload {
  newLegalStructure?: LegalStructureId;
  destinationCountryId?: CountryId;
  destinationStateCode?: string;
  newShareCount?: number;
  issuancePrice?: number;
  issuanceCurrencyCode?: CurrencyCode;
  /** adopt_supershares: vote multiplier the founder's shares will carry. */
  superShareMultiplier?: number;
  /** ticker_change: the new ticker symbol (1–5 uppercase letters). */
  newTicker?: string;
}

export interface CorporationVote {
  _id: ObjectId;
  corporationId: ObjectId;
  type: CorporationVoteType;
  proposedByCharacterId: ObjectId;
  proposedAtTurn: number;
  deadlineAtTurn: number;
  status: CorporationVoteStatus;
  passThreshold: number;
  payload: CorporationVotePayload;
  votes: CorporationVoteCast[];
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
