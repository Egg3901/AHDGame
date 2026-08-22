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

/**
 * A standing instruction from a fund's controlling unit holder on one vote.
 *
 * Stored on the vote rather than in its own collection: an instruction is only
 * ever meaningful for one vote, so it lives and dies with that vote and needs
 * no separate lifecycle or index. `directorCharacterId` is who gave it at the
 * time; directorship is re-verified at resolve time, so selling units below the
 * threshold before the vote closes drops the instruction rather than leaving a
 * stale one in force.
 */
export interface CorporationVoteFundDirection {
  fundId: ObjectId;
  directorCharacterId: ObjectId;
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
  /** Voting-power denominator captured at proposal time. Structure changes invalidate the vote. */
  totalEligibleSharesAtOpen?: number;
  payload: CorporationVotePayload;
  votes: CorporationVoteCast[];
  /**
   * Instructions from controlling unit holders of index funds that hold shares
   * in this corporation. Absent on every vote created before fund direction
   * shipped, which resolves as an undirected fund (mirror or abstain).
   */
  fundDirections?: CorporationVoteFundDirection[];
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
