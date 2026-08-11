import type { ObjectId } from "mongodb";

export type SupporterRequestKind = "wall-name" | "npp-rename";
export type SupporterRequestStatus = "pending" | "approved" | "rejected";

/**
 * A moderated supporter perk request. Supporters submit a display name for the
 * public supporter wall ("wall-name") and Supporter++ members may submit a
 * single one-time NPP rename ("npp-rename"). Moderators approve or reject from
 * the moderator content tab.
 */
export interface SupporterRequest {
  _id: ObjectId;
  userId: ObjectId;
  kind: SupporterRequestKind;
  status: SupporterRequestStatus;
  createdAt: Date;
  decidedAt?: Date;
  decidedBy?: ObjectId;
  rejectionReason?: string;
  // wall-name:
  proposedName?: string;
  // npp-rename:
  nppId?: ObjectId;
  nppSequentialId?: number;
  currentNppName?: string;
  proposedNppName?: string;
}
