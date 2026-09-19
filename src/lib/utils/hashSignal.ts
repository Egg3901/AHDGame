import { createHash } from "crypto";

/**
 * One-way hash of an identity signal, for surfaces a moderator can see.
 *
 * Moderators never receive raw identity signals: `/api/moderator/users` emits
 * these `*Key` hashes in place of the real values, and the identity-history
 * panel hashes fingerprints the same way. Sharing ONE implementation is the
 * point — a moderator comparing a fingerprint in the history panel against the
 * `*Key` column in the users table must see the same string, or the two
 * surfaces silently stop corroborating each other.
 *
 * Truncated to 16 hex characters: long enough that a collision between two real
 * signals is not a practical concern, short enough to read in a table.
 */
export function hashSensitiveSignal(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
