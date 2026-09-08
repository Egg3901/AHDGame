import type { ObjectId } from "mongodb";

export type PushProvider = "fcm" | "apns";
export interface PushDevice {
  /** SHA-256 of a random 256-bit installation secret, never the secret itself. */
  _id: string;
  userId: ObjectId;
  token: string;
  tokenHash: string;
  provider: PushProvider;
  environment: "production" | "development";
  revision: string;
  cursorAt: Date;
  cursorId: ObjectId;
  expiresAt: Date;
  nextAttemptAt: Date;
  leaseUntil: Date;
}
export type DeliveryResult = "sent" | "invalid" | "retry";
