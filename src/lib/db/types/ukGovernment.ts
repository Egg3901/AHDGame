import type { ObjectId } from "mongodb";

/**
 * UK Government document - tracks current PM and ruling party.
 * Single document with _id: "current"
 */
export interface UKGovernment {
  _id: "current";
  /** Character ID of current Prime Minister (null if no PM) */
  pmCharacterId: ObjectId | null;
  /** Party slug of ruling party */
  rulingParty: string;
  /** Active confidence vote ID (if any) */
  confidenceVoteId?: ObjectId;
  /** When current government was formed */
  formedAt?: Date;
  /** Last no-confidence vote timestamp (for cooldown) */
  lastNoConfidenceVoteAt?: Date;
  updatedAt: Date;
}

/**
 * PM No-Confidence Vote - ruling party/coalition MPs vote to remove PM
 */
export interface PmNoConfidenceVote {
  _id: ObjectId;
  /** Character who proposed the motion */
  proposerId: ObjectId;
  /** PM being challenged */
  pmCharacterId: ObjectId;
  /** PM name (cached for display) */
  pmName: string;
  /** Party of PM */
  rulingParty: string;
  /** Number of "yes" votes (no confidence) */
  votesFor: number;
  /** Number of "no" votes (confidence) */
  votesAgainst: number;
  /** Individual MP votes: characterId -> "yes" | "no" */
  mpVotes: Record<string, "yes" | "no">;
  /** List of eligible voter characterIds (ruling party/coalition MPs) */
  eligibleVoters: ObjectId[];
  /** Vote status */
  status: "active" | "passed" | "failed" | "cancelled";
  /** When voting opened */
  openedAt: Date;
  /** When voting is scheduled to close (openedAt + vote duration) */
  closesAt: Date;
  /** When voting actually closed (set on resolution) */
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * UK Confidence Vote - all Commons MPs vote on PM candidate after election or PM removal
 */
export interface UKConfidenceVote {
  _id: ObjectId;
  /** Character nominated as PM */
  nominatedCharacterId: ObjectId;
  /** Party of nominee */
  party: string;
  /** Number of "yes" votes */
  votesFor: number;
  /** Number of "no" votes */
  votesAgainst: number;
  /** Individual MP votes: characterId -> "yes" | "no" */
  mpVotes: Record<string, "yes" | "no">;
  /** Vote status */
  status: "active" | "passed" | "failed";
  /** When voting opened */
  openedAt: Date;
  /** When voting is scheduled to close (openedAt + vote duration) */
  closesAt: Date;
  /** When voting actually closed (set on resolution) */
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
