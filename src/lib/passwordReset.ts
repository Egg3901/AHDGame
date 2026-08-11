/**
 * Password reset tokens.
 *
 * A reset token is minted on POST /api/auth/forgot-password and burned on
 * POST /api/auth/reset-password. Only the sha256 of the raw token is stored
 * (same posture as botApiKeys), so a database read never yields a usable
 * link. Tokens are single use and expire after 30 minutes; expiry is
 * enforced by query filter, not by TTL index, so no index bootstrap is
 * required for correctness.
 */
import { createHash, randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

export const PASSWORD_RESETS_COLLECTION = "passwordResets";
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const TOKEN_PREFIX = "ahdr_";

export interface PasswordResetDiscordDelivery {
  discordId: string;
  url: string;
  queuedAt: Date;
  deliveredAt: Date | null;
}

export interface PasswordResetDoc {
  _id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  /** Set when the account has a linked Discord and the bot should DM the link. */
  discordDelivery: PasswordResetDiscordDelivery | null;
}

export function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Mint a new reset token for a user. Any prior unused tokens for the same
 * user are invalidated first, so only the newest link works.
 */
export async function createPasswordReset(
  userId: ObjectId
): Promise<{ rawToken: string; doc: PasswordResetDoc }> {
  const rawToken = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  const now = new Date();
  const db = await getDb();
  const collection = db.collection<PasswordResetDoc>(PASSWORD_RESETS_COLLECTION);

  await collection.updateMany({ userId, usedAt: null }, { $set: { usedAt: now } });

  const doc: PasswordResetDoc = {
    _id: new ObjectId(),
    userId,
    tokenHash: hashResetToken(rawToken),
    createdAt: now,
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
    usedAt: null,
    discordDelivery: null,
  };
  await collection.insertOne(doc);
  return { rawToken, doc };
}

/**
 * Atomically consume a reset token: marks it used only when it matches,
 * is unused, and is unexpired. Returns the pre-update doc on success so the
 * caller gets the userId, or null on any invalid/expired/used token.
 */
export async function consumePasswordReset(rawToken: string): Promise<PasswordResetDoc | null> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) return null;
  const db = await getDb();
  return db
    .collection<PasswordResetDoc>(PASSWORD_RESETS_COLLECTION)
    .findOneAndUpdate(
      { tokenHash: hashResetToken(rawToken), usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } }
    );
}
