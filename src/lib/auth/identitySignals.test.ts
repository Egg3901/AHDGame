import { describe, expect, it } from "vitest";
import {
  eligibleIdentitySignals,
  IDENTITY_SIGNAL_MAX_AGE_MS,
  type IdentitySignalInput,
} from "./identitySignals";

const NOW = new Date("2026-08-09T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const base: IdentitySignalInput = { createdAt: ago(400 * DAY) };

describe("eligibleIdentitySignals", () => {
  it("reports absent signals as ineligible without a value", () => {
    const result = eligibleIdentitySignals(base, NOW);
    expect(result.trackingId).toEqual({ eligible: false, reason: "absent" });
    expect(result.registrationIp).toEqual({ eligible: false, reason: "absent" });
  });

  it("accepts a signal observed inside the window", () => {
    const result = eligibleIdentitySignals(
      { ...base, trackingId: "t-1", trackingIdAt: ago(5 * DAY) },
      NOW
    );
    expect(result.trackingId.eligible).toBe(true);
    expect(result.trackingId.ageMs).toBe(5 * DAY);
  });

  it("rejects a signal observed outside the window", () => {
    const result = eligibleIdentitySignals(
      { ...base, trackingId: "t-1", trackingIdAt: ago(31 * DAY) },
      NOW
    );
    expect(result.trackingId).toMatchObject({ eligible: false, reason: "stale" });
  });

  // The boundary is inclusive: `ageMs > MAX` is stale, so exactly MAX is still
  // eligible and MAX + 1ms is not. Both sides are pinned because real data
  // rarely lands near the cutoff — a sweep over the testing db showed every
  // threshold from 6d to 101d behaving identically there, so these unit cases
  // are the ONLY thing that fixes the 30-day value.
  it("treats the cutoff boundary as still eligible", () => {
    const result = eligibleIdentitySignals(
      { ...base, trackingId: "t-1", trackingIdAt: ago(IDENTITY_SIGNAL_MAX_AGE_MS) },
      NOW
    );
    expect(result.trackingId.eligible).toBe(true);
    expect(result.trackingId.ageMs).toBe(IDENTITY_SIGNAL_MAX_AGE_MS);
  });

  it("rejects one millisecond past the cutoff", () => {
    const result = eligibleIdentitySignals(
      { ...base, trackingId: "t-1", trackingIdAt: ago(IDENTITY_SIGNAL_MAX_AGE_MS + 1) },
      NOW
    );
    expect(result.trackingId).toMatchObject({ eligible: false, reason: "stale" });
  });

  it("pins the cutoff to 30 days", () => {
    // Guards the constant itself: it must stay equal to the activityLog TTL
    // (2592000s), so no identity signal outlives its source rows.
    expect(IDENTITY_SIGNAL_MAX_AGE_MS).toBe(30 * DAY);
    expect(IDENTITY_SIGNAL_MAX_AGE_MS / 1000).toBe(2_592_000);
  });

  // ── The regression that motivated the whole per-signal stamp design ──
  // `/api/client-nav` refreshes `lastActivity` on every authenticated page load
  // WITHOUT re-observing the tracking cookie, so activity must never rescue a
  // stale signal. `lastActivity` is deliberately not part of the input shape.
  it("does NOT treat a fresh lastActivity as evidence the cookie was re-observed", () => {
    const result = eligibleIdentitySignals(
      {
        ...base,
        trackingId: "t-1",
        trackingIdAt: ago(200 * DAY),
        lastLogin: ago(200 * DAY),
      },
      NOW
    );
    expect(result.trackingId).toMatchObject({ eligible: false, reason: "stale" });
  });

  it("does not advance deviceKey when a login supplied no device key", () => {
    // lastLogin is fresh (the player logged in today from a cleared browser),
    // but deviceKeyAt is a year old because no key was sent.
    const result = eligibleIdentitySignals(
      { ...base, deviceKey: "d-1", deviceKeyAt: ago(365 * DAY), lastLogin: ago(1000) },
      NOW
    );
    expect(result.deviceKey).toMatchObject({ eligible: false, reason: "stale" });
  });

  it("falls back to max(lastLogin, createdAt) when a stamp is absent", () => {
    const legacyFresh = eligibleIdentitySignals(
      { ...base, trackingId: "t-1", lastLogin: ago(2 * DAY) },
      NOW
    );
    expect(legacyFresh.trackingId.eligible).toBe(true);

    const legacyStale = eligibleIdentitySignals(
      { ...base, trackingId: "t-1", lastLogin: ago(90 * DAY) },
      NOW
    );
    expect(legacyStale.trackingId.eligible).toBe(false);
  });

  it("uses createdAt when there is no lastLogin (password account that never logged in)", () => {
    const result = eligibleIdentitySignals({ createdAt: ago(2 * DAY), trackingId: "t-1" }, NOW);
    expect(result.trackingId.eligible).toBe(true);
  });

  it("dates registrationIp by createdAt", () => {
    expect(
      eligibleIdentitySignals({ createdAt: ago(2 * DAY), registrationIp: "8.8.8.8" }, NOW)
        .registrationIp.eligible
    ).toBe(true);
    expect(
      eligibleIdentitySignals({ createdAt: ago(90 * DAY), registrationIp: "8.8.8.8" }, NOW)
        .registrationIp.eligible
    ).toBe(false);
  });

  it("dates registrationFingerprint by its own stamp, not createdAt", () => {
    // OAuth account created long ago, fingerprint backfilled recently.
    const result = eligibleIdentitySignals(
      {
        createdAt: ago(300 * DAY),
        registrationFingerprint: "abc123def456",
        registrationFingerprintAt: ago(3 * DAY),
      },
      NOW
    );
    expect(result.registrationFingerprint.eligible).toBe(true);
  });

  it("excludes Cloudflare edge IPs", () => {
    const result = eligibleIdentitySignals(
      { ...base, lastKnownIp: "104.23.190.204", lastKnownIpAt: ago(1 * DAY) },
      NOW
    );
    expect(result.lastKnownIp).toMatchObject({ eligible: false, reason: "cloudflare_edge" });
  });

  it("excludes sentinel IPs", () => {
    for (const ip of ["unknown", "::1", "127.0.0.1"]) {
      const result = eligibleIdentitySignals(
        { ...base, lastKnownIp: ip, lastKnownIpAt: ago(1 * DAY) },
        NOW
      );
      expect(result.lastKnownIp).toMatchObject({ eligible: false, reason: "sentinel" });
    }
  });

  it("excludes degenerate fingerprints", () => {
    for (const fp of ["server-side", "error", "not-supported", "unknown"]) {
      const result = eligibleIdentitySignals(
        { ...base, lastFingerprint: fp, lastFingerprintAt: ago(1 * DAY) },
        NOW
      );
      expect(result.lastFingerprint).toMatchObject({ eligible: false, reason: "degenerate" });
    }
  });

  // Defensive: this helper runs over EVERY user row on the admin and moderator
  // list endpoints, and Mongo enforces no schema. A single legacy row missing
  // `createdAt` must not throw — that would 500 the whole moderator panel
  // rather than degrade one row.
  it("does not throw when createdAt is missing on a legacy row", () => {
    const malformed = { trackingId: "t-1" } as unknown as IdentitySignalInput;
    expect(() => eligibleIdentitySignals(malformed, NOW)).not.toThrow();
  });

  it("treats a signal with no usable timestamp as stale, not as fresh", () => {
    const malformed = { trackingId: "t-1" } as unknown as IdentitySignalInput;
    const result = eligibleIdentitySignals(malformed, NOW);
    // Fail closed: with no evidence of when this was observed, it must not
    // group accounts.
    expect(result.trackingId.eligible).toBe(false);
  });

  it("prefers the specific reason over staleness", () => {
    const result = eligibleIdentitySignals(
      { ...base, lastKnownIp: "104.23.190.204", lastKnownIpAt: ago(400 * DAY) },
      NOW
    );
    expect(result.lastKnownIp.reason).toBe("cloudflare_edge");
  });
});
