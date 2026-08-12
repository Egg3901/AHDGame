import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * A7: an issuer's petition to the index committee for a listing waiver.
 *
 * Listing standards (A7 part 1) are mechanical and blind. The committee is the
 * discretion on top of them: a corporation that fails a standard may ask to be
 * admitted anyway, and a named officeholder decides. That is what makes index
 * membership political rather than purely arithmetic, which is the whole point
 * of the inclusion-politics half.
 *
 * The committee is NOT a new institution. It is the same era-gated cabinet seat
 * that already rules on merger review, resolved through the same authority
 * query, so a country that has no such seat in this year has no committee and
 * no waivers either.
 */
export type IndexListingPetitionStatus = "pending" | "granted" | "refused";

export interface IndexListingPetition {
  _id: ObjectId;
  corporationId: ObjectId;
  countryId: CountryId;
  /** The CEO who filed it, for the public record. */
  filedByCharacterId: ObjectId;
  filedAtTurn: number;
  /** Refused if undecided by this turn. */
  deadlineAtTurn: number;

  /** The committee seat at filing time, denormalized so the record reads later. */
  seatId: string;
  seatName: string;

  /**
   * Corporate cash spent lobbying, in ₳. Spent on filing and never refunded:
   * lobbying buys attention, not an outcome.
   */
  contributionAnchor: number;
  /** Present when a character held the seat and personally received the money. */
  contributionRecipientCharacterId?: ObjectId;

  status: IndexListingPetitionStatus;
  decidedAtTurn?: number;
  /** Absent when the deadline decided it rather than a person. */
  decidedByCharacterId?: ObjectId;
  /** Set when the deterministic rule decided for an NPP or vacant seat. */
  decidedAutomatically?: boolean;

  /**
   * Last turn the granted waiver is honoured. A waiver is a fixed-term licence,
   * not a permanent exemption, so a corporation that never fixes the underlying
   * problem has to go back and ask again in front of whoever holds the seat then.
   */
  waiverUntilTurn?: number;

  createdAt: Date;
  updatedAt: Date;
}
