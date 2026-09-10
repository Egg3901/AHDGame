/**
 * Permanent source migration fence (legacy auth denial).
 * Absent means unfenced. Any present value denies legacy login, session
 * grants, and credential/provider writes. There is no bypass or unfence path.
 */

/** Document field carrying the fence marker. Absent means unfenced. */
export const AUTH_MIGRATION_FENCE_FIELD = "authMigrationFence" as const;

/**
 * Mongo filter fragment matching only unfenced accounts. AND this into every
 * legacy credential/provider CAS write so a concurrent fence lands as
 * matchedCount 0 with no success. Never add this to the generic revocation
 * snapshot filter: logout, ban, and revocation writes must still work for
 * fenced accounts.
 */
export function authMigrationFenceAbsentFilter(): { authMigrationFence: { $exists: false } } {
  return { authMigrationFence: { $exists: false } };
}

/**
 * Presence predicate for a loaded account doc. Any present value, including
 * null or malformed shapes, counts as fenced and must deny. Only an absent
 * field counts as unfenced. A null account is not fenced.
 */
export function isAuthMigrationFenced(account: object | null | undefined): boolean {
  if (!account) return false;
  return Object.hasOwn(account, AUTH_MIGRATION_FENCE_FIELD);
}

// Fence acquisition must atomically preserve the source credential snapshot and
// advance authRevokedAt, then invalidate the local account cache. Other replicas
// can retain cached accounts for the existing 10-second cache lifetime.
