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
