import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

/**
 * Lifecycle status of a parliamentary government.
 *
 * pending           — Election results are in, seat count is being finalised.
 * forming           — Hung parliament; coalition negotiations underway (kept for backwards compat).
 * minority_pending  — Awaiting player minority-attempt action.
 * formed            — PM appointed, government is active.
 * collapsed         — Vote of no confidence passed; government dissolved, snap election likely.
 * snap_election     — Governing party called an early election; dissolution underway.
 */
export type GovernmentStatus =
  "pending" | "forming" | "minority_pending" | "formed" | "collapsed" | "snap_election";

/**
 * How this government came to power after an election.
 */
export type GovernmentFormationType =
  | "majority" // Single party won ≥ coalitionThreshold seats outright
  | "coalition" // Two+ parties agreed to govern together
  | "confidence_supply" // Minority government supported by a C&S agreement
  | "minority"; // Largest party governs without formal support pact

/**
 * Record of a coalition or confidence-and-supply agreement between parties.
 */
export interface CoalitionAgreement {
  /** All party IDs bound by the agreement */
  partyIds: string[];
  /** Seats each party contributes to the governing coalition */
  seatsContributed: Record<string, number>;
  /** Informal policy commitments (player-authored text, optional) */
  policyCommitments?: string[];
  /** Whether this is a full coalition (cabinet posts) or C&S (votes-only) */
  type: "coalition" | "confidence_supply";
  agreedAt: Date;
}

/**
 * Parliamentary government document.
 * One active document per country at a time (keyed by _id = countryId, e.g. "UK").
 * Completed documents are archived with _id = countryId + "_" + cycle.
 */
export interface ParliamentaryGovernment {
  _id: string; // e.g. "UK" (active) or "UK_3" (archived)
  countryId: CountryId;
  cycle: number;

  status: GovernmentStatus;
  formationType?: GovernmentFormationType;

  // ── Executive ─────────────────────────────────────────────────────────────
  /** Character ID of the serving Prime Minister (null if seat is vacant) */
  pmCharacterId: ObjectId | null;
  /** NPP ID if the PM is a non-player politician */
  pmNppId?: ObjectId;
  /** Cached display name of the PM */
  pmName?: string;

  // ── Parliamentary support ─────────────────────────────────────────────────
  /** The party leading the government */
  governingPartyId: string;
  /** Additional parties in formal coalition (if any) */
  coalitionPartyIds?: string[];
  /** Parties in a confidence-and-supply arrangement (not in cabinet) */
  confidenceSupplyPartyIds?: string[];
  /** Cached total seats supporting the government (governing + coalition + C&S) */
  totalSeatsSupporting: number;
  /** Seats needed for a Commons majority (from CountryConfig.coalitionThreshold) */
  majorityThreshold: number;
  /** True if the government does not command a majority */
  isMinority: boolean;

  // ── Seat distribution ─────────────────────────────────────────────────────
  /** Seats held per party after the election that produced this government */
  seatsByParty: Record<string, number>;
  /** Total seats in the chamber at time of election */
  totalSeats: number;

  // ── Agreement ────────────────────────────────────────────────────────────
  coalitionAgreement?: CoalitionAgreement;

  // ── Confidence vote ────────────────────────────────────────────────────────
  /** ID of the active confidence vote for PM succession, if one is running */
  confidenceVoteId?: ObjectId;
  /** Details of a pending or resolved no-confidence motion */
  noConfidenceVote?: {
    /** Character who tabled the motion */
    triggeredByCharacterId: ObjectId;
    triggeredAt: Date;
    status: "pending" | "passed" | "failed";
    yeaCount: number;
    nayCount: number;
    resolvedAt?: Date;
  };

  // ── Timeline ──────────────────────────────────────────────────────────────
  formedAt?: Date;
  /** Game turn when the government was formed (for LARP date display) */
  formedTurn?: number;
  collapsedAt?: Date;
  /** Reason the government ended */
  dissolutionReason?: "election" | "noConfidence" | "resignation" | "snap";
  /** True when a snap election has been called but not yet started */
  snapElectionPending?: boolean;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Confidence vote to appoint a new PM/Chancellor after an election,
 * no-confidence removal, or a failed confidence vote.
 * Used for all parliamentary countries (UK, CA, DE).
 */
export interface ConfidenceVote {
  _id: ObjectId;
  countryId: CountryId;
  /** Character nominated as PM/Chancellor */
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
  status: "active" | "passed" | "failed" | "cancelled";
  /** When voting opened */
  openedAt: Date;
  /** When voting is scheduled to close (openedAt + vote duration) */
  closesAt: Date;
  /** When voting actually closed (set on resolution) */
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  /** Distinguishes a normal PM-appointment vote from a minority-formation vote */
  voteType?: "majority" | "minority_attempt";
  /**
   * Minimum YES votes needed for this vote to pass.
   * If omitted, simple majority of all votes cast applies.
   */
  threshold?: number;
}

/**
 * A formal vote of no confidence in the current government.
 * Created when a player tables a motion; resolved after the voting window closes.
 */
export interface NoConfidenceVote {
  _id: ObjectId;
  countryId: CountryId;
  /** Government cycle this motion targets */
  cycle: number;
  /** Character who tabled the motion */
  triggeredByCharacterId: ObjectId;
  triggeredByPartyId: string;
  status: "pending" | "passed" | "failed";
  /** Per-character votes (characterId → "yea" | "nay" | "abstain") */
  votes: Record<string, "yea" | "nay" | "abstain">;
  yeaCount: number;
  nayCount: number;
  abstainCount: number;
  /** Turn when the vote was tabled */
  turnTriggered: number;
  /** Turn when the vote window closes */
  turnCloses: number;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
