import type { ObjectId } from "mongodb";

/**
 * One row per unique IP in the `bannedIps` collection.
 * A row represents either a ban (allowRegistration !== true) or an
 * allowance (allowRegistration === true, enforcing maxAccounts).
 */
export interface BannedIp {
  _id: ObjectId;
  ip: string;
  note: string;
  bannedByAdminId: ObjectId;
  bannedByAdminUsername: string;
  bannedAt: Date;

  // Allowance fields — present when allowRegistration === true.
  allowRegistration?: boolean;
  maxAccounts?: number;
  allowReason?: string;
  allowedByAdminUsername?: string;
  allowedAt?: Date;
}
