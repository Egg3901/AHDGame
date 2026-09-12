/**
 * JWT issue time and `authRevokedAt` snapshot matching for reauthentication.
 * Successful reauth keeps the cutoff. `isAuthTokenRevoked` treats
 * `cutoffMs >= iat * 1000` as revoked, and `jose` `setIssuedAt()` uses integer
 * seconds, so a same-second cutoff cannot be escaped by minting a future iat.
 * Wait until the next wall-clock second (bounded), then sign with the actual
 * `floor(now/1000)`. Invalid or future-second cutoffs fail closed. Concurrent
 * reset/logout/ban/unlink is detected by matching the original snapshot in the
 * same write that records login metadata.
 */

/** Overridable clock so tests can fake time without waiting on the wall clock. */
export const reauthClock = {
  now(): number {
    return Date.now();
  },
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  },
};

/** Remainder of the current second is at most 1000ms; never wait longer. */
const MAX_REAUTH_WAIT_MS = 1000;

type RevocationSnapshot =
  | { authRevokedAt: Date | { $exists: false } | { $type: "null" } }
  | { $and: [{ authRevokedAt: { $exists: true } }, { authRevokedAt: { $exists: false } }] };

export type ReauthIssuedAt =
  { ok: true; iat: number; snapshotFilter: RevocationSnapshot } | { ok: false };

function neverMatchSnapshot(): RevocationSnapshot {
  return { $and: [{ authRevokedAt: { $exists: true } }, { authRevokedAt: { $exists: false } }] };
}

/** Filter fragment so a concurrent revocation stamp fails the login write. */
export function authRevocationSnapshotFilter(
  authRevokedAt: Date | null | undefined
): RevocationSnapshot {
  if (authRevokedAt === undefined) {
    return { authRevokedAt: { $exists: false } };
  }
  if (authRevokedAt === null) {
    // Legacy documents may store explicit null. Do not treat that as missing.
    return { authRevokedAt: { $type: "null" } };
  }
  if (authRevokedAt instanceof Date && Number.isFinite(authRevokedAt.getTime())) {
    return { authRevokedAt };
  }
  return neverMatchSnapshot();
}

/**
 * Resolve a non-future JWT NumericDate for reauth. Captures the cutoff snapshot
 * before any wait so the later CAS still matches the original value.
 */
export async function resolveReauthIssuedAt(
  authRevokedAt: Date | null | undefined
): Promise<ReauthIssuedAt> {
  const snapshotFilter = authRevocationSnapshotFilter(authRevokedAt);

  if (authRevokedAt === undefined || authRevokedAt === null) {
    const iat = Math.floor(reauthClock.now() / 1000);
    return Number.isSafeInteger(iat) ? { ok: true, iat, snapshotFilter } : { ok: false };
  }

  if (!(authRevokedAt instanceof Date)) {
    return { ok: false };
  }
  const cutoffMs = authRevokedAt.getTime();
  if (!Number.isFinite(cutoffMs)) {
    return { ok: false };
  }

  const startMs = reauthClock.now();
  if (!Number.isFinite(startMs)) {
    return { ok: false };
  }
  const startSec = Math.floor(startMs / 1000);
  const cutoffSec = Math.floor(cutoffMs / 1000);
  if (!Number.isSafeInteger(startSec) || !Number.isSafeInteger(cutoffSec)) {
    return { ok: false };
  }

  // Future-second cutoff would require waiting past the next second. Fail closed
  // instead of waiting unbounded or treating the cutoff as absent.
  if (cutoffSec > startSec) {
    return { ok: false };
  }

  if (cutoffSec === startSec) {
    const waitMs = (startSec + 1) * 1000 - startMs;
    if (!Number.isFinite(waitMs) || waitMs <= 0 || waitMs > MAX_REAUTH_WAIT_MS) {
      return { ok: false };
    }
    await reauthClock.sleep(waitMs);
  }

  const iat = Math.floor(reauthClock.now() / 1000);
  if (!Number.isSafeInteger(iat)) {
    return { ok: false };
  }
  // Still inside the cutoff second (clock did not advance, or sleep returned
  // early): do not mint a future iat to escape it.
  if (cutoffMs >= iat * 1000) {
    return { ok: false };
  }
  return { ok: true, iat, snapshotFilter };
}
