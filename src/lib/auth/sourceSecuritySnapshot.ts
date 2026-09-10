/**
 * Source security snapshot binding for future ownership proof.
 * Captures the password/provider/role/revocation state of a freshly loaded
 * account plus its source binding into one versioned canonical JSON encoding
 * with a SHA256 digest, so a later ownership proof cannot remain valid after
 * a password, provider, role, or revocation change.
 *
 * This is NOT ownership proof, authentication, or authorization, and it makes
 * no allow/deny decision: see captureSourceSecuritySnapshot. It never activates
 * a migration and never commits anything; the caller passes already-loaded
 * trusted data and keeps the returned payload for the later ceremony.
 */

import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";

/** Version pinned into both the payload and the canonical encoding. */
export const SOURCE_SECURITY_SNAPSHOT_VERSION = 1 as const;

/** Thrown for any malformed binding, mismatched source id, hostile field, or fenced/deleting row. Messages are generic and never echo input. */
export class SourceSecuritySnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceSecuritySnapshotError";
  }
}

/**
 * Narrow slice of the account this needs. Extra profile fields (email,
 * username, displayName, biography, and the like) are accepted by callers but
 * never read, so changing them cannot touch the digest.
 */
export interface SourceSecuritySnapshotUser {
  readonly _id: ObjectId;
  readonly password?: string | null;
  readonly googleId?: string | null;
  readonly discordId?: string | null;
  readonly role?: string | null;
  readonly isAdmin?: boolean | null;
  readonly isBanned?: boolean | null;
  readonly authRevokedAt?: Date | null;
  readonly accountDeletion?: unknown;
  readonly authMigrationFence?: unknown;
}

/**
 * Exact binding for the later proof. All four values come from the trusted
 * caller (never from a browser flow): the source that loaded this row and the
 * enrollment the snapshot is captured for.
 */
export interface SourceSecuritySnapshotBinding {
  readonly sourceIssuer: string;
  readonly sourceAccountId: string;
  readonly canonicalAccountId: string;
  readonly enrollmentOperationId: string;
}

/**
 * Immutable primitive payload. Only strings and the version number: no raw
 * password digest, no permission verdict, no mutable Date references.
 */
export interface SourceSecuritySnapshot {
  readonly version: 1;
  readonly canonicalEncoding: string;
  readonly snapshotDigest: string;
}

const SOURCE_ACCOUNT_ID_PATTERN = /^[0-9a-f]{24}$/;
const UUID_V4_LOWERCASE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f]/;
const WHITESPACE_PATTERN = /\s/;
const MAX_STRING_LENGTH = 512;

const SNAPSHOT_KEY_ORDER = [
  "password",
  "googleId",
  "discordId",
  "role",
  "isAdmin",
  "isBanned",
  "authRevokedAt",
  "accountDeletion",
  "authMigrationFence",
] as const;

type TaggedValue = { t: string; v?: string | number | boolean };

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hasField(user: object, key: string): boolean {
  return Object.hasOwn(user, key);
}

function readField(
  user: SourceSecuritySnapshotUser,
  key: keyof SourceSecuritySnapshotUser
): unknown {
  return user[key];
}

function encodeSecretField(
  kind: "password" | "provider",
  value: unknown,
  present: boolean
): TaggedValue {
  if (!present) return { t: "absent" };
  if (value === null) return { t: "null" };
  if (typeof value !== "string")
    throw new SourceSecuritySnapshotError("invalid account snapshot state");
  if (value.length === 0) return { t: "empty" };
  if (value.length > MAX_STRING_LENGTH || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new SourceSecuritySnapshotError("invalid account snapshot state");
  }
  if (kind === "password") return { t: "sha256", v: sha256Hex(value) };
  return { t: "id", v: value };
}

function encodeRole(value: unknown, present: boolean): TaggedValue {
  if (!present) return { t: "absent" };
  if (value === null) return { t: "null" };
  if (typeof value !== "string")
    throw new SourceSecuritySnapshotError("invalid account snapshot state");
  if (value.length === 0) return { t: "empty" };
  if (value === "admin" || value === "moderator" || value === "player") {
    return { t: "role", v: value };
  }
  throw new SourceSecuritySnapshotError("invalid account snapshot state");
}

function encodeBoolean(value: unknown, present: boolean): TaggedValue {
  if (!present) return { t: "absent" };
  if (value === null) return { t: "null" };
  if (typeof value === "boolean") return { t: "bool", v: value };
  throw new SourceSecuritySnapshotError("invalid account snapshot state");
}

function encodeRevokedAt(value: unknown, present: boolean): TaggedValue {
  if (!present) return { t: "absent" };
  if (value === null) return { t: "null" };
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return { t: "ms", v: value.getTime() };
  }
  throw new SourceSecuritySnapshotError("invalid account snapshot state");
}

function checkIssuer(issuer: unknown): string {
  if (
    typeof issuer !== "string" ||
    issuer.length < 1 ||
    issuer.length > MAX_STRING_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(issuer) ||
    WHITESPACE_PATTERN.test(issuer)
  ) {
    throw new SourceSecuritySnapshotError("invalid source snapshot binding");
  }
  return issuer;
}

function checkUuid(value: unknown): string {
  if (typeof value !== "string" || value.length !== 36 || !UUID_V4_LOWERCASE_PATTERN.test(value)) {
    throw new SourceSecuritySnapshotError("invalid source snapshot binding");
  }
  return value;
}

/**
 * Capture a deterministic snapshot of a freshly loaded account, bound to the
 * exact source and enrollment it was read for.
 *
 * This decides nothing: it only encodes. A fenced row (any present
 * authMigrationFence, including null) or a row with any present
 * accountDeletion (including null) throws before encoding. Absent, null,
 * empty-string, and set states encode as distinct tagged values, and a
 * nonempty stored password digest encodes as the SHA256 of those exact bytes,
 * never the bytes themselves. isBanned, role, and isAdmin encode as exact
 * data, never as a migration-eligibility verdict. Nothing is logged.
 */
export function captureSourceSecuritySnapshot(
  user: SourceSecuritySnapshotUser,
  binding: SourceSecuritySnapshotBinding
): SourceSecuritySnapshot {
  if (!user || typeof user !== "object" || !binding || typeof binding !== "object") {
    throw new SourceSecuritySnapshotError("invalid account record");
  }
  const actualHex = user._id instanceof ObjectId ? user._id.toHexString() : null;
  if (actualHex === null || !SOURCE_ACCOUNT_ID_PATTERN.test(actualHex)) {
    throw new SourceSecuritySnapshotError("invalid account record");
  }
  const sourceAccountId = binding.sourceAccountId;
  if (
    typeof sourceAccountId !== "string" ||
    !SOURCE_ACCOUNT_ID_PATTERN.test(sourceAccountId) ||
    sourceAccountId !== actualHex
  ) {
    throw new SourceSecuritySnapshotError("source account mismatch");
  }
  const sourceIssuer = checkIssuer(binding.sourceIssuer);
  const canonicalAccountId = checkUuid(binding.canonicalAccountId);
  const enrollmentOperationId = checkUuid(binding.enrollmentOperationId);

  if (hasField(user, "authMigrationFence")) {
    throw new SourceSecuritySnapshotError("account fenced for migration");
  }
  if (hasField(user, "accountDeletion")) {
    throw new SourceSecuritySnapshotError("account deletion pending");
  }

  const passwordPresent = hasField(user, "password");
  const googlePresent = hasField(user, "googleId");
  const discordPresent = hasField(user, "discordId");
  const rolePresent = hasField(user, "role");
  const adminPresent = hasField(user, "isAdmin");
  const bannedPresent = hasField(user, "isBanned");
  const revokedPresent = hasField(user, "authRevokedAt");

  const encoded: Record<(typeof SNAPSHOT_KEY_ORDER)[number], TaggedValue> = {
    password: encodeSecretField("password", readField(user, "password"), passwordPresent),
    googleId: encodeSecretField("provider", readField(user, "googleId"), googlePresent),
    discordId: encodeSecretField("provider", readField(user, "discordId"), discordPresent),
    role: encodeRole(readField(user, "role"), rolePresent),
    isAdmin: encodeBoolean(readField(user, "isAdmin"), adminPresent),
    isBanned: encodeBoolean(readField(user, "isBanned"), bannedPresent),
    authRevokedAt: encodeRevokedAt(readField(user, "authRevokedAt"), revokedPresent),
    accountDeletion: { t: "absent" },
    authMigrationFence: { t: "absent" },
  };

  const canonicalValue: Record<string, unknown> = {
    v: SOURCE_SECURITY_SNAPSHOT_VERSION,
    sourceIssuer,
    sourceAccountId,
    canonicalAccountId,
    enrollmentOperationId,
  };
  for (const key of SNAPSHOT_KEY_ORDER) canonicalValue[key] = encoded[key];
  const canonicalEncoding = JSON.stringify(canonicalValue);
  const snapshotDigest = sha256Hex(canonicalEncoding);
  return Object.freeze({
    version: SOURCE_SECURITY_SNAPSHOT_VERSION,
    canonicalEncoding,
    snapshotDigest,
  });
}
