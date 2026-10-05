/**
 * Email change tokens.
 *
 * A signed-in player asks for a new address on POST /api/auth/change-email.
 * The address only lands on the account after the link mailed to it is
 * burned on POST /api/auth/confirm-email, so nobody can claim an inbox they
 * do not control. Storage mirrors passwordReset: only the sha256 of the raw
 * token is kept, tokens are single use, and expiry is a query filter.
 */
import { createHash, randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

export const EMAIL_CHANGES_COLLECTION = "emailChanges";
export const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;
const TOKEN_PREFIX = "ahde_";

export interface EmailChangeDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** The address on the account when the change was requested. Confirm is a CAS on it. */
  previousEmail: string;
  newEmail: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
}

export function hashEmailChangeToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Mint a change token. Earlier unused tokens for the same user stop working. */
export async function createEmailChange(
  userId: ObjectId,
  previousEmail: string,
  newEmail: string
): Promise<{ rawToken: string; doc: EmailChangeDoc }> {
  const rawToken = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  const now = new Date();
  const db = await getDb();
  const collection = db.collection<EmailChangeDoc>(EMAIL_CHANGES_COLLECTION);

  await collection.updateMany({ userId, usedAt: null }, { $set: { usedAt: now } });

  const doc: EmailChangeDoc = {
    _id: new ObjectId(),
    userId,
    previousEmail,
    newEmail,
    tokenHash: hashEmailChangeToken(rawToken),
    createdAt: now,
    expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TTL_MS),
    usedAt: null,
  };
  await collection.insertOne(doc);
  return { rawToken, doc };
}

/** Atomically burn a token. Returns the pre-update doc, or null when invalid, used, or expired. */
export async function consumeEmailChange(rawToken: string): Promise<EmailChangeDoc | null> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) return null;
  const db = await getDb();
  return db
    .collection<EmailChangeDoc>(EMAIL_CHANGES_COLLECTION)
    .findOneAndUpdate(
      { tokenHash: hashEmailChangeToken(rawToken), usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } }
    );
}
