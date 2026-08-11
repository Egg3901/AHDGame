import type { ObjectId } from "mongodb";

/**
 * Moderation state for player-submitted banner ads. New submissions start
 * `pending` and only serve publicly once an admin approves them (Google ads
 * run on the same public pages, so unreviewed UGC must never serve there).
 * Legacy ads created before this field existed have no value and are treated
 * as approved (they were already live under post-hoc review).
 */
export type PlayerBannerAdModerationStatus = "pending" | "approved" | "rejected";

export interface PlayerBannerAd {
  _id: ObjectId;
  characterId: ObjectId;
  userId: ObjectId;
  characterName: string;
  countryId: string;
  imageUrl: string;
  linkUrl?: string;
  altText?: string;
  viewCount: number;
  isActive: boolean;
  /** Absent on legacy docs (= approved). See PlayerBannerAdModerationStatus. */
  moderationStatus?: PlayerBannerAdModerationStatus;
  moderatedAt?: Date;
  createdAt: Date;
  /** Game turn the ad was submitted (turn-based rate-limit clock). */
  createdTurn: number;
  costPaid: number;
  currencyCode: string;
}
