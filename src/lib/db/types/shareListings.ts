import type { ObjectId } from "mongodb";

export interface ShareListing {
  _id: ObjectId;
  /** The corporation whose shares are being listed */
  corporationId: ObjectId;
  /** The character who created this listing */
  sellerCharacterId: ObjectId;
  /** Set when listing on behalf of a corporation */
  sellerCorporationId?: ObjectId;
  /** Original shares listed — does not change */
  sharesListed: number;
  /** Shares still available (decrements as offers are accepted) */
  sharesRemaining: number;
  /**
   * corp.sharePrice snapshot at creation time.
   * Sets the 50%–200% price bounds for incoming offers.
   */
  marketPriceAtCreation: number;
  status: "open" | "cancelled" | "filled";
  createdAt: Date;
  /** 24 turns after creation — turn processing expires when now >= expiresAt. */
  expiresAt: Date;
  /**
   * Turn-based mirror of `expiresAt` (createTurn + 24). Turn processing expires
   * the listing when `currentTurn >= expiresAtTurn`, so expiry freezes on pause
   * and doesn't drift with the game clock. Absent on legacy rows → Date fallback.
   */
  expiresAtTurn?: number;
}

export interface ShareOffer {
  _id: ObjectId;
  listingId: ObjectId;
  /** Denormalized for bulk lookups during expiry */
  corporationId: ObjectId;
  /** The character making the offer */
  buyerCharacterId: ObjectId;
  /** Set when offering as a corporation */
  buyerCorporationId?: ObjectId;
  /** Total shares the buyer wants */
  shares: number;
  /**
   * Per-share offer price.
   * Must be between 50% and 200% of listing.marketPriceAtCreation.
   */
  pricePerShare: number;
  /** Total held in escrow: shares * pricePerShare */
  escrowAmount: number;
  status: "pending" | "accepted" | "expired" | "cancelled";
  createdAt: Date;
}
