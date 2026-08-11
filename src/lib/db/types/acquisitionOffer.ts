import type { ObjectId } from "mongodb";

export type AcquisitionOfferStatus = "pending" | "accepted" | "rejected" | "withdrawn" | "expired";

/**
 * An agreed corp-to-corp acquisition offer: the acquirer's CEO offers to buy the
 * whole target corporation for `priceAnchor` (₳). The target's CEO accepts or
 * rejects. On accept, the target is absorbed into the acquirer and its
 * shareholders are cashed out (see executeAgreedAcquisition). Stored in the
 * `acquisitionOffers` collection. Gated by the `corpDealsEnabled` game flag.
 */
export interface AcquisitionOffer {
  _id: ObjectId;
  acquirerCorporationId: ObjectId;
  targetCorporationId: ObjectId;
  /** The acquirer's CEO character at propose time. */
  proposedByCharacterId: ObjectId;
  /** The proposing user (for authorization checks on withdraw). */
  proposedByUserId?: ObjectId;
  /** Agreed all-in price for the whole target, in ₳ (anchor units). */
  priceAnchor: number;
  /** Canonical target valuation captured at propose time (₳) — display + fair-value floor. */
  targetValuationAnchor: number;
  status: AcquisitionOfferStatus;
  createdAtTurn: number;
  expiresAtTurn: number;
  resolvedAtTurn?: number;
  createdAt: Date;
  updatedAt: Date;
}
