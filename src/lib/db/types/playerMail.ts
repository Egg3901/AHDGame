import type { ObjectId } from "mongodb";

export interface PlayerMail {
  _id: ObjectId;
  /** Absent for system-generated mail (forex notifications, game events). */
  fromCharacterId?: ObjectId;
  fromCharacterName: string;
  /** Absent for system-generated mail. */
  fromCharacterSequentialId?: number;
  toUserId: ObjectId;
  toCharacterId: ObjectId;
  toCharacterName: string;
  toCharacterSequentialId: number;
  subject: string;
  body: string;
  read: boolean;
  deletedByRecipient: boolean;
  deletedBySender: boolean;
  /** Set while the recipient has the sender blocked; hides it from the inbox. */
  blockedByRecipient?: boolean;
  createdAt: Date;
}

export interface PlayerMailReport {
  _id: ObjectId;
  mailId: ObjectId;
  reportedByUserId: ObjectId;
  status: "pending" | "dismissed" | "actioned";
  adminNote?: string;
  reviewedAt?: Date;
  reviewedByAdminId?: ObjectId;
  createdAt: Date;
}

/** Why a player reported another player's content. */
export type PlayerReportReason =
  "harassment" | "hate" | "sexual" | "violence" | "spam" | "impersonation" | "other";

/** Where the reported content was seen, so moderators can find it quickly. */
export type PlayerReportContext = "profile" | "news" | "party" | "corporation" | "other";

/**
 * A player's report of another player's user-generated content (name, bio,
 * portrait, campaign song, articles). App Store rule 1.2 requires a way to
 * report objectionable content; mail has its own `PlayerMailReport`.
 */
export interface PlayerContentReport {
  _id: ObjectId;
  reportedByUserId: ObjectId;
  targetUserId: ObjectId;
  targetCharacterId: ObjectId;
  /** Snapshot at report time; the character may be renamed or deleted later. */
  targetCharacterName: string;
  reason: PlayerReportReason;
  context: PlayerReportContext;
  details?: string;
  status: "pending" | "dismissed" | "actioned";
  adminNote?: string;
  reviewedAt?: Date;
  reviewedByAdminId?: ObjectId;
  createdAt: Date;
}
