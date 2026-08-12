import type { ObjectId } from "mongodb";
import type { CorporationType } from "@/lib/constants/corporations";

export type MergerReviewStatus = "pending" | "cleared" | "clearedWithRemedy" | "blocked";

/** How a pending review reached its terminal status. */
export type MergerReviewResolver = "authority" | "deadline";

/** What put the deal in front of the authority. */
export type MergerReviewTrigger = "agreedAcquisition" | "hostileTakeover";

/** One industry where the two firms overlap, as measured at referral. */
export interface MergerOverlapFinding {
  sectorType: CorporationType;
  /** Acquirer's share of the national market before the deal, 0-100. */
  acquirerSharePercent: number;
  /** Target's share before the deal, 0-100. */
  targetSharePercent: number;
  /** Combined share the deal would produce, 0-100. */
  combinedSharePercent: number;
}

/**
 * A referred merger, stored in `mergerReviews`. One review covers one
 * (acquirer, target) pair; the pair is unique among PENDING reviews.
 *
 * A pending or blocked review is a hard gate on execution. A cleared review is
 * a durable clearance: the same pair can complete the deal without a second
 * referral, which is what makes the hostile-takeover retry path work.
 */
export interface MergerReview {
  _id: ObjectId;
  acquirerCorporationId: ObjectId;
  targetCorporationId: ObjectId;
  acquirerName: string;
  targetName: string;
  /** The reviewing country — the TARGET's home country. */
  countryId: string;
  /** Cabinet seat id holding the authority; name resolves per era at read time. */
  authoritySeatId: string;
  /** Enacted antitrust level 0-4 at referral, and the threshold it produced. */
  lawLevel: number;
  thresholdPercent: number;
  /** Worst overlapping industry — the one that tripped the threshold. */
  leadSectorType: CorporationType;
  combinedSharePercent: number;
  overlaps: MergerOverlapFinding[];
  trigger: MergerReviewTrigger;
  status: MergerReviewStatus;
  openedAtTurn: number;
  /** Turn at which an undecided review auto-resolves on the published bands. */
  decideByTurn: number;
  resolvedAtTurn?: number;
  resolvedBy?: MergerReviewResolver;
  /** Character who handed down the decision, when an authority did. */
  decidedByCharacterId?: ObjectId;
  /** Free-text rationale the officeholder attached, shown to both CEOs. */
  decisionNote?: string;
  /** Set on `clearedWithRemedy`: the industry the acquirer must divest. */
  remedySectorType?: CorporationType;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The live obligation created when a remedied deal completes, stored on the
 * acquiring corporation as `pendingDivestiture`.
 *
 * Discharged by MEASUREMENT, not by procedure: the acquirer's controlled group
 * must fall back below `thresholdPercent` in the named industry. A spin-off
 * into a wholly-owned subsidiary keeps the group's share exactly where it was
 * and does not discharge anything; spinning off and then selling down does.
 * Overdue, it fines the corp every turn and bars new acquisitions.
 */
export interface PendingDivestiture {
  reviewId: ObjectId;
  sectorType: CorporationType;
  /** Turn by which the group must be back below `thresholdPercent`. */
  dueTurn: number;
  /**
   * The share the acquirer's controlled group must fall below in that industry
   * for the order to discharge. Carried on the obligation rather than re-read
   * from the law, so a later repeal cannot retroactively satisfy a standing
   * order (or a later tightening make an already-met one fail).
   */
  thresholdPercent: number;
  /** Reviewing country, so the fine reaches the right treasury. */
  countryId: string;
}
