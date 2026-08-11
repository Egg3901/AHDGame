import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { ActivityLogAuth } from "@/lib/db/types/activityLog";
import {
  buildSharedAuthArtifactFlags,
  buildCoordinatedLoginFlags,
  anchorComponentsMatch,
} from "./suspiciousDetection";

describe("buildSharedAuthArtifactFlags", () => {
  it("flags shared tracking cookies and exact fingerprints across accounts", () => {
    const now = new Date("2026-04-16T12:00:00.000Z");
    const userA = new ObjectId("507f1f77bcf86cd799439011");
    const userB = new ObjectId("507f1f77bcf86cd799439012");
    const charA = new ObjectId("507f1f77bcf86cd799439021");
    const charB = new ObjectId("507f1f77bcf86cd799439022");

    const flags = buildSharedAuthArtifactFlags(
      now,
      [
        { _id: charA, userId: userA },
        { _id: charB, userId: userB },
      ],
      [
        {
          _id: userA,
          username: "alpha",
          trackingId: "track-shared",
          registrationFingerprint: "fp-shared",
          lastFingerprint: "fp-shared",
          fingerprintHistory: ["fp-shared"],
        },
        {
          _id: userB,
          username: "bravo",
          trackingId: "track-shared",
          registrationFingerprint: "fp-shared",
          lastFingerprint: "fp-shared",
          fingerprintHistory: ["fp-shared"],
        },
      ]
    );

    expect(flags.get(charA.toString())?.map((flag) => flag.type)).toEqual(
      expect.arrayContaining(["shared_tracking_cookie", "shared_fingerprint"])
    );
    expect(flags.get(charB.toString())?.map((flag) => flag.type)).toEqual(
      expect.arrayContaining(["shared_tracking_cookie", "shared_fingerprint"])
    );
    expect(flags.get(charA.toString())?.[0]?.detail).toContain("bravo");
  });

  it("keeps shared_fingerprint at medium for exactly 2 accounts", () => {
    const now = new Date("2026-05-30T12:00:00.000Z");
    const uA = new ObjectId("507f1f77bcf86cd799439a11");
    const uB = new ObjectId("507f1f77bcf86cd799439a12");
    const cA = new ObjectId("507f1f77bcf86cd799439a21");
    const cB = new ObjectId("507f1f77bcf86cd799439a22");
    const flags = buildSharedAuthArtifactFlags(
      now,
      [
        { _id: cA, userId: uA },
        { _id: cB, userId: uB },
      ],
      [
        { _id: uA, username: "a", lastFingerprint: "fp", fingerprintHistory: ["fp"] },
        { _id: uB, username: "b", lastFingerprint: "fp", fingerprintHistory: ["fp"] },
      ]
    );
    const fp = flags.get(cA.toString())?.find((f) => f.type === "shared_fingerprint");
    expect(fp?.severity).toBe("medium");
    expect(fp?.evidence.accountCount).toBe(2);
    expect(fp?.evidence.matchType).toBe("exact");
  });

  it("escalates shared_fingerprint to high for 3+ accounts on one exact fingerprint", () => {
    const now = new Date("2026-05-30T12:00:00.000Z");
    const ids = [11, 12, 13].map((n) => new ObjectId(`507f1f77bcf86cd7994390${n}`));
    const chars = [21, 22, 23].map((n) => new ObjectId(`507f1f77bcf86cd7994390${n}`));
    const flags = buildSharedAuthArtifactFlags(
      now,
      ids.map((u, i) => ({ _id: chars[i], userId: u })),
      ids.map((u, i) => ({
        _id: u,
        username: `u${i}`,
        lastFingerprint: "fpX",
        fingerprintHistory: ["fpX"],
      }))
    );
    const fp = flags.get(chars[0].toString())?.find((f) => f.type === "shared_fingerprint");
    expect(fp?.severity).toBe("high");
    expect(fp?.evidence.accountCount).toBe(3);
  });

  it("does NOT escalate to high when the shared fingerprint is degenerate (low-entropy)", () => {
    const now = new Date("2026-05-30T12:00:00.000Z");
    const ids = [31, 32, 33].map((n) => new ObjectId(`507f1f77bcf86cd7994390${n}`));
    const chars = [41, 42, 43].map((n) => new ObjectId(`507f1f77bcf86cd7994390${n}`));
    const flags = buildSharedAuthArtifactFlags(
      now,
      ids.map((u, i) => ({ _id: chars[i], userId: u })),
      ids.map((u, i) => ({
        _id: u,
        username: `d${i}`,
        lastFingerprint: "server-side",
        fingerprintHistory: ["server-side"],
      }))
    );
    const fp = flags.get(chars[0].toString())?.find((f) => f.type === "shared_fingerprint");
    expect(fp?.severity).toBe("medium");
    expect(fp?.evidence.accountCount).toBe(3);
  });

  it("emits a fuzzy shared_fingerprint flag (medium) when hashes differ but anchors match", () => {
    const now = new Date("2026-05-30T12:00:00.000Z");
    const uA = new ObjectId("507f1f77bcf86cd799439b11");
    const uB = new ObjectId("507f1f77bcf86cd799439b12");
    const cA = new ObjectId("507f1f77bcf86cd799439b21");
    const cB = new ObjectId("507f1f77bcf86cd799439b22");
    const comps = { canvas: "C", webglRenderer: "G", audio: "A", fonts: "F", screen: "S" };
    const flags = buildSharedAuthArtifactFlags(
      now,
      [
        { _id: cA, userId: uA },
        { _id: cB, userId: uB },
      ],
      [
        { _id: uA, username: "a", lastFingerprint: "hashA", lastFingerprintComponents: comps },
        {
          _id: uB,
          username: "b",
          lastFingerprint: "hashB",
          lastFingerprintComponents: { ...comps, fonts: "DIFF" },
        },
      ]
    );
    const fp = flags.get(cA.toString())?.find((f) => f.type === "shared_fingerprint");
    expect(fp?.severity).toBe("medium");
    expect(fp?.evidence.matchType).toBe("fuzzy");
  });
});

describe("anchorComponentsMatch", () => {
  const base = {
    canvas: "C",
    webglRenderer: "G",
    audio: "A",
    fonts: "F",
    cores: 8,
    memory: 8,
    screen: "1920x1080",
    timezone: "Europe/London",
    platform: "Win32",
  };

  it("matches identical components", () => {
    expect(anchorComponentsMatch(base, { ...base })).toBe(true);
  });

  it("matches when exactly one secondary component drifts", () => {
    expect(anchorComponentsMatch(base, { ...base, fonts: "DIFFERENT" })).toBe(true);
  });

  it("does NOT match when two secondary components drift", () => {
    expect(anchorComponentsMatch(base, { ...base, fonts: "X", screen: "800x600" })).toBe(false);
  });

  it("does NOT match when an anchor differs", () => {
    expect(anchorComponentsMatch(base, { ...base, canvas: "OTHER" })).toBe(false);
  });

  it("does NOT match when an anchor is missing on one side", () => {
    const noAudio = { ...base };
    delete (noAudio as { audio?: string }).audio;
    expect(anchorComponentsMatch(base, noAudio)).toBe(false);
  });

  // forensics-v2 Part B: webglVendor/languages richer secondary anchors.
  it("still matches when the new webglVendor/languages fields are present and equal on both sides", () => {
    const richer = { ...base, webglVendor: "Google Inc. (NVIDIA)", languages: "en-US,en" };
    expect(anchorComponentsMatch(richer, { ...richer })).toBe(true);
  });

  it("backward-compatible: still matches a legacy record missing webglVendor/languages entirely (pre-feature capture)", () => {
    const richer = { ...base, webglVendor: "Google Inc. (NVIDIA)", languages: "en-US,en" };
    // `base` has neither new field — missing on one side is skipped, not charged as drift.
    expect(anchorComponentsMatch(richer, base)).toBe(true);
  });

  it("the richer fields add real precision: a webglVendor mismatch combined with one other drift now correctly fails (2 drifts)", () => {
    const richer = { ...base, webglVendor: "Google Inc. (NVIDIA)", languages: "en-US,en" };
    const other = { ...richer, webglVendor: "Apple Inc.", fonts: "DIFFERENT" };
    expect(anchorComponentsMatch(richer, other)).toBe(false);
  });

  it("a lone webglVendor mismatch (no other drift) alone still matches — one drift is tolerated", () => {
    const richer = { ...base, webglVendor: "Google Inc. (NVIDIA)", languages: "en-US,en" };
    const other = { ...richer, webglVendor: "Apple Inc." };
    expect(anchorComponentsMatch(richer, other)).toBe(true);
  });
});

describe("buildCoordinatedLoginFlags", () => {
  it("flags repeated near-simultaneous logins between matching accounts", () => {
    const now = new Date("2026-04-16T12:00:00.000Z");
    const userA = new ObjectId("507f1f77bcf86cd799439031");
    const userB = new ObjectId("507f1f77bcf86cd799439032");
    const charA = new ObjectId("507f1f77bcf86cd799439041");
    const charB = new ObjectId("507f1f77bcf86cd799439042");
    const base = new Date("2026-04-10T14:00:00.000Z");

    const loginLogs: ActivityLogAuth[] = [
      {
        _id: new ObjectId("507f1f77bcf86cd799439051"),
        type: "login",
        timestamp: new Date(base),
        userId: userA,
        username: "alpha",
        ipAddress: "203.0.113.10",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
        fingerprint: "fp-shared",
        trackingId: "track-shared",
      },
      {
        _id: new ObjectId("507f1f77bcf86cd799439052"),
        type: "login",
        timestamp: new Date(base.getTime() + 2 * 60 * 1000),
        userId: userB,
        username: "bravo",
        ipAddress: "203.0.113.10",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
        fingerprint: "fp-shared",
        trackingId: "track-shared",
      },
      {
        _id: new ObjectId("507f1f77bcf86cd799439053"),
        type: "login",
        timestamp: new Date(base.getTime() + 24 * 60 * 60 * 1000),
        userId: userA,
        username: "alpha",
        ipAddress: "203.0.113.10",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
        fingerprint: "fp-shared",
        trackingId: "track-shared",
      },
      {
        _id: new ObjectId("507f1f77bcf86cd799439054"),
        type: "login",
        timestamp: new Date(base.getTime() + 24 * 60 * 60 * 1000 + 4 * 60 * 1000),
        userId: userB,
        username: "bravo",
        ipAddress: "203.0.113.10",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
        fingerprint: "fp-shared",
        trackingId: "track-shared",
      },
      {
        _id: new ObjectId("507f1f77bcf86cd799439055"),
        type: "login",
        timestamp: new Date(base.getTime() + 2 * 24 * 60 * 60 * 1000),
        userId: userA,
        username: "alpha",
        ipAddress: "203.0.113.10",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
        fingerprint: "fp-shared",
        trackingId: "track-shared",
      },
      {
        _id: new ObjectId("507f1f77bcf86cd799439056"),
        type: "login",
        timestamp: new Date(base.getTime() + 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 1000),
        userId: userB,
        username: "bravo",
        ipAddress: "203.0.113.10",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
        fingerprint: "fp-shared",
        trackingId: "track-shared",
      },
    ];

    const flags = buildCoordinatedLoginFlags(
      now,
      [
        { _id: charA, userId: userA },
        { _id: charB, userId: userB },
      ],
      loginLogs
    );

    const alphaFlag = flags.get(charA.toString());
    const bravoFlag = flags.get(charB.toString());

    expect(alphaFlag?.type).toBe("coordinated_login_pattern");
    expect(alphaFlag?.severity).toBe("high");
    expect(alphaFlag?.detail).toContain("bravo");
    expect(alphaFlag?.detail).toContain("3 overlaps");
    expect(alphaFlag?.evidence).toMatchObject({
      overlapWindowMinutes: 15,
      matches: [
        expect.objectContaining({
          otherUsername: "bravo",
          overlapCount: 3,
          sharedTrackingIds: ["track-shared"],
          sharedFingerprints: ["fp-shared"],
        }),
      ],
    });
    expect(bravoFlag?.detail).toContain("alpha");
  });
});
