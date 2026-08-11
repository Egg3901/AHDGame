import { isCloudflareEdgeIp } from "@/lib/utils/cloudflareIpRanges";
import { isDegenerateFingerprint } from "@/lib/utils/degenerateFingerprints";

/**
 * Per-signal eligibility for identity matching (design spec §2).
 *
 * PURE — no database, no `next/headers`. Both `/api/admin/users` and
 * `/api/moderator/users` call this server-side and emit the result alongside
 * the (unchanged) field values, so the client-side grouping in
 * `duplicateGroups.ts` can filter without needing raw IPs it is not allowed to
 * see. The moderator endpoint only ever emits sha256 hashes, so neither a CIDR
 * check nor a sentinel-string check is possible client-side — that is why this
 * has to run BEFORE the values are hashed.
 */

/** Evidence older than this no longer groups accounts. Matches the existing
 * `activityLog` TTL (2592000s) so no signal outlives its source rows. */
export const IDENTITY_SIGNAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** IP values that are placeholders rather than addresses. `getClientIp` falls
 * back to the literal string `"unknown"` when no proxy header resolves. */
const SENTINEL_IPS: ReadonlySet<string> = new Set(["unknown", "::1", "127.0.0.1"]);

export type IdentitySignalName =
  | "registrationIp"
  | "lastKnownIp"
  | "registrationFingerprint"
  | "lastFingerprint"
  | "trackingId"
  | "deviceKey";

export type IneligibleReason = "absent" | "stale" | "cloudflare_edge" | "sentinel" | "degenerate";

export interface SignalEligibility {
  eligible: boolean;
  reason?: IneligibleReason;
  /** Age of the observation in ms. Present whenever the signal has a value,
   * eligible or not, so the UI can show "newest evidence: 12 days old". */
  ageMs?: number;
}

export type IdentitySignalEligibility = Record<IdentitySignalName, SignalEligibility>;

/**
 * The narrow slice of `User` this needs.
 *
 * Deliberately NOT the full `User` type: `lastActivity` is excluded so it
 * cannot be reached for by accident. `/api/client-nav` refreshes that field on
 * every authenticated page load without re-observing any identity signal, which
 * makes it worthless — and actively harmful — as a signal timestamp.
 */
export interface IdentitySignalInput {
  createdAt: Date;
  lastLogin?: Date | null;
  registrationIp?: string | null;
  lastKnownIp?: string | null;
  lastKnownIpAt?: Date | null;
  registrationFingerprint?: string | null;
  registrationFingerprintAt?: Date | null;
  lastFingerprint?: string | null;
  lastFingerprintAt?: Date | null;
  trackingId?: string | null;
  trackingIdAt?: Date | null;
  deviceKey?: string | null;
  deviceKeyAt?: Date | null;
}

/** True for a usable `Date`. Mongo enforces no schema, so a legacy row can
 * carry a missing or malformed value where the `User` type promises a `Date`. */
function isUsableDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function latest(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  const usableA = isUsableDate(a) ? a : null;
  const usableB = isUsableDate(b) ? b : null;
  if (!usableA) return usableB;
  if (!usableB) return usableA;
  return usableA.getTime() > usableB.getTime() ? usableA : usableB;
}

/** Shared fallback for the last-write-wins signals, used only by rows written
 * before the `*At` stamps existed. `createdAt` is part of it because
 * `/api/auth/register` never writes `lastLogin` — without it, a password
 * account that never logged in again would be ineligible from day one. */
function sessionFallback(user: IdentitySignalInput): Date | null {
  return latest(user.lastLogin, user.createdAt);
}

/** Prefer the signal's own `*At` stamp; fall back only when it is absent or
 * malformed. Deliberately NOT "whichever is newer" — the stamp is the
 * authoritative observation time, and a fallback that could win would
 * reintroduce the proxy-timestamp bug this design exists to remove. */
function stampOr(stamp: Date | null | undefined, fallback: Date | null): Date | null {
  return isUsableDate(stamp) ? stamp : fallback;
}

interface SignalSpec {
  value: string | null | undefined;
  /** `null` when no usable timestamp could be resolved — see `evaluate`. */
  observedAt: Date | null;
  kind: "ip" | "fingerprint" | "opaque";
}

function evaluate(spec: SignalSpec, now: Date): SignalEligibility {
  if (!spec.value) return { eligible: false, reason: "absent" };

  // Fail closed on a row with no usable timestamp. This helper runs over EVERY
  // user on the admin/moderator list endpoints and Mongo enforces no schema, so
  // one malformed legacy row must degrade that row rather than throw and 500
  // the whole panel. Treating it as `stale` is also the safe direction: with no
  // evidence of when the signal was observed, it must not group accounts.
  if (!spec.observedAt) return { eligible: false, reason: "stale" };

  const ageMs = now.getTime() - spec.observedAt.getTime();

  // Value-shape problems are reported ahead of staleness: "this is a Cloudflare
  // edge address" is more actionable to a moderator than "this is old", and the
  // guard applies regardless of age.
  if (spec.kind === "ip") {
    if (SENTINEL_IPS.has(spec.value)) return { eligible: false, reason: "sentinel", ageMs };
    if (isCloudflareEdgeIp(spec.value)) {
      return { eligible: false, reason: "cloudflare_edge", ageMs };
    }
  }
  if (spec.kind === "fingerprint" && isDegenerateFingerprint(spec.value)) {
    return { eligible: false, reason: "degenerate", ageMs };
  }

  if (ageMs > IDENTITY_SIGNAL_MAX_AGE_MS) return { eligible: false, reason: "stale", ageMs };
  return { eligible: true, ageMs };
}

/**
 * Decide which of a user's identity signals may still group them with another
 * account.
 *
 * See the design spec's signal timestamp table for why each signal is dated the
 * way it is. Every one carries its own `*At` stamp, with no exemptions, because
 * three separate review rounds each falsified a different proposed exemption.
 */
export function eligibleIdentitySignals(
  user: IdentitySignalInput,
  now: Date
): IdentitySignalEligibility {
  const fallback = sessionFallback(user);
  // Sanitized once — every `createdAt` read below goes through this, because a
  // legacy row can carry a missing or malformed value despite the type.
  const createdAt = isUsableDate(user.createdAt) ? user.createdAt : null;

  return {
    // Written once at account creation and never again, so creation time IS
    // observation time.
    registrationIp: evaluate(
      { value: user.registrationIp, observedAt: createdAt, kind: "ip" },
      now
    ),
    // NOT dated by createdAt: `/api/auth/record-fingerprint` backfills this for
    // OAuth accounts, potentially long after signup.
    registrationFingerprint: evaluate(
      {
        value: user.registrationFingerprint,
        observedAt: stampOr(user.registrationFingerprintAt, createdAt),
        kind: "fingerprint",
      },
      now
    ),
    lastKnownIp: evaluate(
      { value: user.lastKnownIp, observedAt: stampOr(user.lastKnownIpAt, fallback), kind: "ip" },
      now
    ),
    lastFingerprint: evaluate(
      {
        value: user.lastFingerprint,
        observedAt: stampOr(user.lastFingerprintAt, fallback),
        kind: "fingerprint",
      },
      now
    ),
    trackingId: evaluate(
      { value: user.trackingId, observedAt: stampOr(user.trackingIdAt, fallback), kind: "opaque" },
      now
    ),
    deviceKey: evaluate(
      { value: user.deviceKey, observedAt: stampOr(user.deviceKeyAt, fallback), kind: "opaque" },
      now
    ),
  };
}
