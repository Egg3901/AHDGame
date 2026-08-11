import type { ObjectId } from "mongodb";

/**
 * Private share invitation: a CEO of a private corporation with a multi-
 * shareholder legal structure (e.g. S-Corp, capped at 100) offers a specific
 * character a fixed number of shares at a fixed per-share price.
 *
 * The invitee can accept (paying the agreed cash from their wallet and
 * receiving shares) or decline; the CEO can also cancel before acceptance.
 *
 * Acceptance is gated by the legal structure's `maxShareholders` cap and by
 * the corporation's free issuance capacity (newly-issued shares come from
 * the corp's authorized-but-unissued pool, mirroring real-world preferred-
 * stock private placements).
 */
export type CorporationShareInviteStatus =
  "pending" | "accepted" | "declined" | "cancelled" | "expired";

export interface CorporationShareInvite {
  _id: ObjectId;
  corporationId: ObjectId;
  /** Snapshot for display when corp doc isn't loaded. */
  corporationName: string;
  /** Character invited to become a shareholder. */
  invitedCharacterId: ObjectId;
  invitedCharacterName: string;
  /** CEO who issued the invite (for audit). */
  issuedByCharacterId: ObjectId;
  issuedByCharacterName: string;
  shares: number;
  pricePerShare: number;
  /** Total cost in the corp's liquid currency. Cached for client display. */
  totalCost: number;
  /** Currency the price is denominated in (matches corp.liquidCurrencyCode). */
  currencyCode: string;
  status: CorporationShareInviteStatus;
  /** Wall-clock expiry; defaults to 7 days after creation. */
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  acceptedAt?: Date;
  declinedAt?: Date;
  cancelledAt?: Date;
}
