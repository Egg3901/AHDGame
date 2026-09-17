import type { Filter } from "mongodb";
import type { User } from "@/lib/db/types";
import { authRevocationSnapshotFilter } from "@/lib/auth/sessionIssue";
import { authMigrationFenceAbsentFilter } from "@/lib/auth/sourceFence";

export type ProviderKind = "google" | "discord";

type CredentialSnapshot = Pick<
  User,
  "password" | "googleId" | "discordId" | "authRevokedAt" | "authMigrationFence"
>;

/** A stored password counts as a usable login method only when non-empty. */
export function hasUsablePassword(account: Pick<User, "password">): boolean {
  return typeof account.password === "string" && account.password.length > 0;
}

/** The linked provider id, or null when no usable link exists. */
export function linkedProviderId(
  account: Pick<User, "googleId" | "discordId">,
  kind: ProviderKind
): string | null {
  const raw = kind === "google" ? account.googleId : account.discordId;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * CAS filter fragment binding a provider link/unlink write to the exact
 * credential snapshot read just before it. A concurrent password,
 * provider-link, ban, or revocation write changes one of these fields and
 * fails the write instead of being silently overwritten.
 */
export function providerWriteSnapshotFilter(account: CredentialSnapshot): Filter<User> {
  return {
    password: account.password ?? null,
    // Absent links match missing fields exactly. No writer stores an explicit
    // null provider id (link sets a string, unlink removes the field), so
    // `$exists: false` pins the snapshot without a nullable cast.
    ...(account.googleId === undefined
      ? { googleId: { $exists: false } }
      : { googleId: account.googleId }),
    ...(account.discordId === undefined
      ? { discordId: { $exists: false } }
      : { discordId: account.discordId }),
    isBanned: { $ne: true },
    ...authRevocationSnapshotFilter(account.authRevokedAt),
    ...authMigrationFenceAbsentFilter(),
  };
}

export type ProviderLinkDecision =
  { ok: true; mode: "link" | "idempotent" } | { ok: false; reason: "conflict" };

/**
 * Linking must never silently replace a different existing provider link.
 * Same-id retries are idempotent; a different stored id requires an
 * explicit unlink first.
 */
export function decideProviderLink(
  account: Pick<User, "googleId" | "discordId">,
  kind: ProviderKind,
  incomingId: string
): ProviderLinkDecision {
  const current = linkedProviderId(account, kind);
  if (current === incomingId) return { ok: true, mode: "idempotent" };
  if (current) return { ok: false, reason: "conflict" };
  return { ok: true, mode: "link" };
}

export type ProviderUnlinkDecision =
  { ok: true; linkedId: string } | { ok: false; reason: "not_linked" | "last_method" };

/**
 * Unlinking the last remaining usable login method (non-empty password or
 * the other provider) would lock the account out, so it is rejected. An
 * already-absent link is idempotent success regardless of other methods.
 */
export function decideProviderUnlink(
  account: Pick<User, "password" | "googleId" | "discordId">,
  kind: ProviderKind
): ProviderUnlinkDecision {
  const linkedId = linkedProviderId(account, kind);
  if (!linkedId) return { ok: false, reason: "not_linked" };
  const other = kind === "google" ? "discord" : "google";
  if (!hasUsablePassword(account) && !linkedProviderId(account, other)) {
    return { ok: false, reason: "last_method" };
  }
  return { ok: true, linkedId };
}
