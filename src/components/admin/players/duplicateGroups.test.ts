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
});
