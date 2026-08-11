import type { User } from "@/lib/db/types";

/**
 * Process-local, short-TTL cache for the per-request `users.findOne` that every
 * authenticated request performs (see `getAuthUser` / `getAuthUserWithCharacter`
 * in `src/lib/auth.ts`).
 *
 * Why this exists: a single page load fires many parallel `/api/*` requests
 * (the connection-pool comment in `src/lib/mongodb.ts` notes "7+ parallel auth
 * requests"), and each one re-reads the user document to enforce ban / token
 * revocation. On the persistent Railway server that redundant read is pure
 * latency. Caching the user doc for a few seconds collapses that storm into a
 * single DB round-trip per user.
 *
 * Correctness tradeoff: ban / `authRevokedAt` enforcement is normally immediate
 * (read fresh every request). With this cache it is bounded by `TTL_MS` instead.
 * The paths that revoke access (`/api/admin|moderator/users/ban`, logout-all,
 * password change) call `invalidateCachedUser()` so enforcement stays immediate
 * for the cases we control; the TTL is the safety bound for everything else.
 *
 * This is a deliberate single-process cache. It is NOT shared across replicas —
 * acceptable because the bound is seconds and the data is re-validated by JWT
 * signature on every request regardless.
 */

const TTL_MS = 10_000;
const MAX_ENTRIES = 3_000;

// Disabled under test so the shared process Map can't leak user state across
// cases — the cache is a production latency optimization, not behaviour.
const ENABLED = process.env.NODE_ENV !== "test";

type Entry = { user: User; expiresAt: number };

const cache = new Map<string, Entry>();

export function getCachedUser(userId: string): User | undefined {
  if (!ENABLED) return undefined;
  const entry = cache.get(userId);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(userId);
    return undefined;
  }

  // Map preserves insertion order, so reinsert cache hits to keep the least
  // recently used key at the front for bounded eviction.
  cache.delete(userId);
  cache.set(userId, entry);
  return entry.user;
}

export function setCachedUser(userId: string, user: User): void {
  if (!ENABLED) return;
  cache.delete(userId);
  cache.set(userId, { user, expiresAt: Date.now() + TTL_MS });
  if (cache.size > MAX_ENTRIES) {
    const oldestUserId = cache.keys().next().value;
    if (oldestUserId !== undefined) cache.delete(oldestUserId);
  }
}

/**
 * Drop a user from the cache so the next auth resolution re-reads from the DB.
 * Call this from any path that bans, unbans, or revokes a user's tokens.
 */
export function invalidateCachedUser(userId: string): void {
  cache.delete(userId);
}
