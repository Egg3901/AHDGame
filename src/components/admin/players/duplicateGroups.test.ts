import { describe, expect, it } from "vitest";
import { getDuplicateGroups } from "./duplicateGroups";
import type { UserData } from "./types";

const DAY = 24 * 60 * 60 * 1000;

function user(id: string, overrides: Partial<UserData> = {}): UserData {
  return {
    id,
    username: `user-${id}`,
    email: `${id}@example.com`,
    role: "user",
    isAdmin: false,
    isBanned: false,
    characterId: null,
    characterName: null,
    party: null,
    registrationIp: null,
    lastKnownIp: null,
    lastAuthToken: null,
    registrationFingerprint: null,
    lastFingerprint: null,
    fingerprintCount: 0,
    trackingId: null,
    deviceKey: null,
    lastLogin: null,
    lastLogout: null,
    createdAt: new Date().toISOString(),
    discordId: null,
    discordUsername: null,
    modNote: null,
    ...overrides,
  };
}

const eligible = (ageMs: number) => ({ eligible: true as const, ageMs });
const stale = (ageMs: number) => ({ eligible: false as const, reason: "stale" as const, ageMs });
const absent = { eligible: false as const, reason: "absent" as const };

function eligibility(
  overrides: Partial<NonNullable<UserData["signalEligibility"]>> = {}
): UserData["signalEligibility"] {
  return {
    registrationIp: absent,
    lastKnownIp: absent,
    registrationFingerprint: absent,
    lastFingerprint: absent,
    trackingId: absent,
    deviceKey: absent,
    ...overrides,
  };
}

describe("getDuplicateGroups", () => {
  it("groups two accounts sharing a recent IP", () => {
    const groups = getDuplicateGroups([
      user("a", {
        lastKnownIp: "68.192.35.139",
        signalEligibility: eligibility({ lastKnownIp: eligible(2 * DAY) }),
      }),
      user("b", {
        lastKnownIp: "68.192.35.139",
        signalEligibility: eligibility({ lastKnownIp: eligible(3 * DAY) }),
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  // The headline behaviour change: a shared registration IP from years ago
  // must no longer weld two accounts together.
  it("does NOT group two accounts whose only shared IP is stale", () => {
    const groups = getDuplicateGroups([
      user("a", {
        registrationIp: "192.204.106.2",
        signalEligibility: eligibility({ registrationIp: stale(400 * DAY) }),
      }),
      user("b", {
        registrationIp: "192.204.106.2",
        signalEligibility: eligibility({ registrationIp: stale(400 * DAY) }),
      }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("does not group on an ineligible signal even when another user's is fresh", () => {
    const groups = getDuplicateGroups([
      user("a", {
        lastKnownIp: "68.192.35.139",
        signalEligibility: eligibility({ lastKnownIp: eligible(1 * DAY) }),
      }),
      user("b", {
        lastKnownIp: "68.192.35.139",
        signalEligibility: eligibility({ lastKnownIp: stale(200 * DAY) }),
      }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("still groups on a fresh device key when IPs are stale", () => {
    const groups = getDuplicateGroups([
      user("a", {
        deviceKey: "dk-1",
        registrationIp: "192.204.106.2",
        signalEligibility: eligibility({
          deviceKey: eligible(1 * DAY),
          registrationIp: stale(400 * DAY),
        }),
      }),
      user("b", {
        deviceKey: "dk-1",
        registrationIp: "192.204.106.2",
        signalEligibility: eligibility({
          deviceKey: eligible(1 * DAY),
          registrationIp: stale(400 * DAY),
        }),
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members[0].matchReasons).toContain("device");
    expect(groups[0].members[0].matchReasons).not.toContain("ip");
  });

  it("reports the newest evidence age for the group", () => {
    const groups = getDuplicateGroups([
      user("a", {
        deviceKey: "dk-1",
        signalEligibility: eligibility({ deviceKey: eligible(9 * DAY) }),
      }),
      user("b", {
        deviceKey: "dk-1",
        signalEligibility: eligibility({ deviceKey: eligible(4 * DAY) }),
      }),
    ]);
    expect(groups[0].newestEvidenceMs).toBe(4 * DAY);
  });

  it("groups on hashed values from the moderator endpoint", () => {
    const groups = getDuplicateGroups([
      user("a", {
        lastKnownIpKey: "hash-abc",
        signalEligibility: eligibility({ lastKnownIp: eligible(1 * DAY) }),
      }),
      user("b", {
        lastKnownIpKey: "hash-abc",
        signalEligibility: eligibility({ lastKnownIp: eligible(1 * DAY) }),
      }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("groups nothing when the annotation is missing (stale client bundle)", () => {
    const groups = getDuplicateGroups([
      user("a", { lastKnownIp: "68.192.35.139" }),
      user("b", { lastKnownIp: "68.192.35.139" }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("groups two accounts that shared a fingerprint in the past but have both rotated away", () => {
    const groups = getDuplicateGroups([
      user("a", {
        lastFingerprint: "current-a",
        historicalFingerprints: ["10f9219d"],
        signalEligibility: eligibility({ lastFingerprint: eligible(DAY) }),
      }),
      user("b", {
        lastFingerprint: "current-b",
        historicalFingerprints: ["10f9219d"],
        signalEligibility: eligibility({ lastFingerprint: eligible(DAY) }),
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
  });

  it("labels a historical fingerprint match distinctly from a current one", () => {
    const groups = getDuplicateGroups([
      user("a", { historicalFingerprints: ["shared"], signalEligibility: eligibility() }),
      user("b", { historicalFingerprints: ["shared"], signalEligibility: eligibility() }),
    ]);
    expect(groups[0].members[0].matchReasons).toContain("fingerprint-past");
    expect(groups[0].members[0].matchReasons).not.toContain("fingerprint");
  });

  it("prefers the current reason when a value is both current and historical", () => {
    const groups = getDuplicateGroups([
      user("a", {
        lastFingerprint: "shared",
        historicalFingerprints: ["shared"],
        signalEligibility: eligibility({ lastFingerprint: eligible(DAY) }),
      }),
      user("b", {
        lastFingerprint: "shared",
        historicalFingerprints: ["shared"],
        signalEligibility: eligibility({ lastFingerprint: eligible(DAY) }),
      }),
    ]);
    expect(groups[0].members[0].matchReasons).toContain("fingerprint");
    expect(groups[0].members[0].matchReasons).not.toContain("fingerprint-past");
  });

  it("groups on a historical IP and labels it ip-past", () => {
    const groups = getDuplicateGroups([
      user("a", { historicalIps: ["72.22.186.58"], signalEligibility: eligibility() }),
      user("b", { historicalIps: ["72.22.186.58"], signalEligibility: eligibility() }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members[0].matchReasons).toContain("ip-past");
  });

  it("does not group on historical values a user does not actually share", () => {
    const groups = getDuplicateGroups([
      user("a", { historicalIps: ["1.1.1.1"], signalEligibility: eligibility() }),
      user("b", { historicalIps: ["2.2.2.2"], signalEligibility: eligibility() }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("groups on hashed historical keys in the moderator context", () => {
    const groups = getDuplicateGroups([
      user("a", { historicalFingerprintKeys: ["hash-xyz"], signalEligibility: eligibility() }),
      user("b", { historicalFingerprintKeys: ["hash-xyz"], signalEligibility: eligibility() }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members[0].matchReasons).toContain("fingerprint-past");
  });

  it("flags the IP-only member of a mixed group as a weak match", () => {
    const groups = getDuplicateGroups([
      user("strong1", {
        lastFingerprint: "fp",
        lastKnownIp: "5.5.5.5",
        lastDevice: "desktop",
        signalEligibility: eligibility({
          lastFingerprint: eligible(DAY),
          lastKnownIp: eligible(DAY),
        }),
      }),
      user("strong2", {
        lastFingerprint: "fp",
        lastKnownIp: "5.5.5.5",
        lastDevice: "desktop",
        signalEligibility: eligibility({
          lastFingerprint: eligible(DAY),
          lastKnownIp: eligible(DAY),
        }),
      }),
      user("weak", {
        lastKnownIp: "5.5.5.5",
        lastDevice: "mobile",
        signalEligibility: eligibility({ lastKnownIp: eligible(DAY) }),
      }),
    ]);
    expect(groups).toHaveLength(1);
    const byId = new Map(groups[0].members.map((m) => [m.id, m]));
    expect(byId.get("weak")?.weakMatch).toBe(true);
    expect(byId.get("strong1")?.weakMatch).toBe(false);
    expect(byId.get("strong2")?.weakMatch).toBe(false);
  });

  it("treats a historical-IP-only member as weak too", () => {
    const groups = getDuplicateGroups([
      user("strong1", {
        lastFingerprint: "fp",
        historicalIps: ["9.9.9.9"],
        signalEligibility: eligibility({ lastFingerprint: eligible(DAY) }),
      }),
      user("strong2", {
        lastFingerprint: "fp",
        signalEligibility: eligibility({ lastFingerprint: eligible(DAY) }),
      }),
      user("weak", { historicalIps: ["9.9.9.9"], signalEligibility: eligibility() }),
    ]);
    const byId = new Map(groups[0].members.map((m) => [m.id, m]));
    expect(byId.get("weak")?.matchReasons).toEqual(["ip-past"]);
    expect(byId.get("weak")?.weakMatch).toBe(true);
  });

  it("surfaces a historical-only fingerprint match in the group header", () => {
    const groups = getDuplicateGroups([
      user("a", { historicalFingerprints: ["rotated"], signalEligibility: eligibility() }),
      user("b", { historicalFingerprints: ["rotated"], signalEligibility: eligibility() }),
    ]);
    expect(groups[0].sharedHistoricalFingerprints).toEqual(["rotated"]);
    // The group exists because of a value nobody currently carries, so the
    // live-evidence lists must stay empty rather than borrowing from it.
    expect(groups[0].sharedFingerprints).toEqual([]);
    expect(groups[0].sharedIps).toEqual([]);
  });

  it("does not report a value as both current and historical evidence", () => {
    const groups = getDuplicateGroups([
      user("a", {
        lastFingerprint: "shared",
        historicalFingerprints: ["shared"],
        signalEligibility: eligibility({ lastFingerprint: eligible(DAY) }),
      }),
      user("b", {
        lastFingerprint: "shared",
        historicalFingerprints: ["shared"],
        signalEligibility: eligibility({ lastFingerprint: eligible(DAY) }),
      }),
    ]);
    expect(groups[0].sharedFingerprints).toEqual(["shared"]);
    expect(groups[0].sharedHistoricalFingerprints).toEqual([]);
  });
});
