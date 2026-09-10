/**
 * Fresh source password check for later account migration.
 * verifySourcePasswordOwnership matches a supplied password to the stored
 * hash on a trusted loaded ordinary password-only account. It does not sign
 * anyone in, issue a proof, or pick a target, and it does not persist or
 * claim to erase the password.
 */

import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";

/** Thrown for ineligible or malformed input. Messages are generic and never echo the password or hash. */
export class SourcePasswordOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourcePasswordOwnershipError";
  }
}

/**
 * Narrow slice of a freshly loaded source account. Extra profile fields
 * (email, username, and the like) are accepted but never read.
 */
export interface SourcePasswordOwnershipUser {
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

const SOURCE_ACCOUNT_ID_PATTERN = /^[0-9a-f]{24}$/;
const BCRYPT_COST12_PATTERN = /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/;
const MAX_PASSWORD_UTF8_BYTES = 72;

type CapturedState = {
  idHex: string;
  fencePresent: boolean;
  deletionPresent: boolean;
  passwordPresent: boolean;
  password: unknown;
  googlePresent: boolean;
  googleId: unknown;
  discordPresent: boolean;
  discordId: unknown;
  rolePresent: boolean;
  role: unknown;
  isAdminPresent: boolean;
  isAdmin: unknown;
  isBannedPresent: boolean;
  isBanned: unknown;
  revokedKind: "absent" | "null" | "ms" | "malformed";
  revokedMs: number | null;
};

function hasField(user: object, key: string): boolean {
  return Object.hasOwn(user, key);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isWellFormedUtf16(value: string): boolean {
  return value.isWellFormed();
}

function isCost12BcryptHash(value: string): boolean {
  return value.length === 60 && utf8ByteLength(value) === 60 && BCRYPT_COST12_PATTERN.test(value);
}

function captureState(user: SourcePasswordOwnershipUser): CapturedState {
  const actualHex = user._id instanceof ObjectId ? user._id.toHexString() : null;
  if (actualHex === null || !SOURCE_ACCOUNT_ID_PATTERN.test(actualHex)) {
    throw new SourcePasswordOwnershipError("invalid account record");
  }

  const revokedPresent = hasField(user, "authRevokedAt");
  const revoked = user.authRevokedAt;
  let revokedKind: CapturedState["revokedKind"];
  let revokedMs: number | null = null;
  if (!revokedPresent) {
    revokedKind = "absent";
  } else if (revoked === null) {
    revokedKind = "null";
  } else if (revoked instanceof Date && Number.isFinite(revoked.getTime())) {
    revokedKind = "ms";
    revokedMs = revoked.getTime();
  } else {
    revokedKind = "malformed";
  }

  return {
    idHex: actualHex,
    fencePresent: hasField(user, "authMigrationFence"),
    deletionPresent: hasField(user, "accountDeletion"),
    passwordPresent: hasField(user, "password"),
    password: user.password,
    googlePresent: hasField(user, "googleId"),
    googleId: user.googleId,
    discordPresent: hasField(user, "discordId"),
    discordId: user.discordId,
    rolePresent: hasField(user, "role"),
    role: user.role,
    isAdminPresent: hasField(user, "isAdmin"),
    isAdmin: user.isAdmin,
    isBannedPresent: hasField(user, "isBanned"),
    isBanned: user.isBanned,
    revokedKind,
    revokedMs,
  };
}

function sameSecurityState(left: CapturedState, right: CapturedState): boolean {
  return (
    left.idHex === right.idHex &&
    left.fencePresent === right.fencePresent &&
    left.deletionPresent === right.deletionPresent &&
    left.passwordPresent === right.passwordPresent &&
    left.password === right.password &&
    left.googlePresent === right.googlePresent &&
    left.googleId === right.googleId &&
    left.discordPresent === right.discordPresent &&
    left.discordId === right.discordId &&
    left.rolePresent === right.rolePresent &&
    left.role === right.role &&
    left.isAdminPresent === right.isAdminPresent &&
    left.isAdmin === right.isAdmin &&
    left.isBannedPresent === right.isBannedPresent &&
    left.isBanned === right.isBanned &&
    left.revokedKind === right.revokedKind &&
    left.revokedMs === right.revokedMs
  );
}

function assertNoSocialMethod(present: boolean, value: unknown): void {
  if (!present || value === null) return;
  if (typeof value === "string" && value.length === 0) return;
  throw new SourcePasswordOwnershipError("account not eligible");
}

function capturedHashOrThrow(state: CapturedState): string {
  if (state.fencePresent || state.deletionPresent) {
    throw new SourcePasswordOwnershipError("account not eligible");
  }
  if (state.revokedKind === "malformed") {
    throw new SourcePasswordOwnershipError("account not eligible");
  }
  if (!state.rolePresent || state.role !== "player") {
    throw new SourcePasswordOwnershipError("account not eligible");
  }
  if (state.isAdminPresent && state.isAdmin !== false) {
    throw new SourcePasswordOwnershipError("account not eligible");
  }
  if (state.isBannedPresent && state.isBanned !== false) {
    throw new SourcePasswordOwnershipError("account not eligible");
  }
  assertNoSocialMethod(state.googlePresent, state.googleId);
  assertNoSocialMethod(state.discordPresent, state.discordId);
  if (
    !state.passwordPresent ||
    typeof state.password !== "string" ||
    !isCost12BcryptHash(state.password)
  ) {
    throw new SourcePasswordOwnershipError("account not eligible");
  }
  return state.password;
}

function suppliedPasswordOrThrow(password: unknown): string {
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    password.length >= MAX_PASSWORD_UTF8_BYTES
  ) {
    throw new SourcePasswordOwnershipError("invalid password");
  }
  if (password.includes("\u0000") || !isWellFormedUtf16(password)) {
    throw new SourcePasswordOwnershipError("invalid password");
  }
  if (utf8ByteLength(password) >= MAX_PASSWORD_UTF8_BYTES) {
    throw new SourcePasswordOwnershipError("invalid password");
  }
  return password;
}

/**
 * Verify fresh password knowledge on a trusted loaded source account.
 *
 * Returns true only when the captured stored hash is a cost-12 bcrypt digest
 * and bcryptjs.compare accepts the supplied password against that captured
 * hash, then the live record still matches the captured security fields.
 * Returns false when compare fails or throws. Throws
 * SourcePasswordOwnershipError for an ineligible or malformed record or
 * supplied password. Never logs, never returns the password or stored hash,
 * and does not persist either value. JavaScript strings cannot be zeroized;
 * this documents no persistence, not erasure.
 *
 * This is not an authentication grant, membership check, durable proof,
 * fence, session, or target activation. It does not bind a canonical
 * account or enrollment operation. The caller still has to snapshot the
 * same original loaded source state once those bindings exist, then
 * compare-and-set against that original snapshot before any migration write.
 * A later database read is not the state whose password was verified. This
 * helper detects mutations of its input during bcrypt; it does not detect
 * concurrent database changes or reserve any state after it returns.
 */
export async function verifySourcePasswordOwnership(
  user: SourcePasswordOwnershipUser,
  password: string
): Promise<boolean> {
  if (!user || typeof user !== "object") {
    throw new SourcePasswordOwnershipError("invalid account record");
  }
  const before = captureState(user);
  const storedHash = capturedHashOrThrow(before);
  const supplied = suppliedPasswordOrThrow(password);

  let matched = false;
  try {
    matched = await bcrypt.compare(supplied, storedHash);
  } catch {
    return false;
  }
  if (matched !== true) return false;

  if (!user || typeof user !== "object") {
    throw new SourcePasswordOwnershipError("verification failed");
  }
  const after = captureState(user);
  if (!sameSecurityState(before, after)) {
    throw new SourcePasswordOwnershipError("verification failed");
  }
  return true;
}
