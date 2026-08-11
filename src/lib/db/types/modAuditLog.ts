import type { ObjectId } from "mongodb";

/** Tracks every privileged action a moderator takes, for admin review. */
export interface ModAuditLogEntry {
  _id: ObjectId;
  moderatorId: ObjectId;
  moderatorName: string;
  action: string;
  targetUserId?: ObjectId;
  targetUsername?: string;
  details?: string;
  createdAt: Date;
}
