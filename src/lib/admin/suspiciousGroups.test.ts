import { describe, expect, it } from "vitest";
import { buildMatchGroups, type SuspiciousEntry } from "./suspiciousGroups";

function entry(
  overrides: Partial<SuspiciousEntry> & Pick<SuspiciousEntry, "_id">
): SuspiciousEntry {
  return {
    characterId: overrides._id,
    characterName: overrides._id,
    userId: overrides._id,
    username: overrides._id,
    countryId: "US",
    flags: [],
    flagCount: 0,
    highestSeverity: "low",
    lastUpdated: "2026-07-01T00:00:00.000Z",
    dismissed: false,
    ...overrides,
  };
}

describe("buildMatchGroups", () => {
  it("groups accounts linked by a shared fingerprint into one cluster", () => {
    const a = entry({
      _id: "charA",
      userId: "userA",
      username: "alice",
      highestSeverity: "high",
      flags: [
        {
          type: "shared_fingerprint",
          severity: "high",
          detail: "Shared fingerprint with bob",
          detectedAt: "2026-07-01T00:00:00.000Z",
          evidence: { sharedWith: [{ userId: "userB", username: "bob" }] },
        },
      ],
    });
    const b = entry({
      _id: "charB",
      userId: "userB",
      username: "bob",
      highestSeverity: "high",
      flags: [
        {
          type: "shared_fingerprint",
          severity: "high",
          detail: "Shared fingerprint with alice",
          detectedAt: "2026-07-01T00:00:00.000Z",
          evidence: { sharedWith: [{ userId: "userA", username: "alice" }] },
        },
      ],
    });
    const c = entry({ _id: "charC", userId: "userC", username: "carol" });

    const groups = buildMatchGroups([a, b, c]);

    expect(groups).toHaveLength(2);
    const pair = groups.find((g) => g.members.length === 2)!;
    expect(pair.members.map((m) => m.username).sort()).toEqual(["alice", "bob"]);
    expect(pair.isNetworkOnly).toBe(false);
    const solo = groups.find((g) => g.members.length === 1)!;
    expect(solo.members[0].username).toBe("carol");
  });

  it("links accounts whose only shared evidence is an IP (no userId in evidence)", () => {
    const a = entry({
      _id: "charA",
      userId: "userA",
      username: "alice",
      flags: [
        {
          type: "ip_sharing",
          severity: "medium",
          detail: "Logged in from same IP as: bob",
          detectedAt: "2026-07-01T00:00:00.000Z",
          evidence: { sharedWith: [{ ip: "203.0.113.5", otherUsername: "bob" }] },
        },
      ],
    });
    const b = entry({
      _id: "charB",
      userId: "userB",
      username: "bob",
      flags: [
        {
          type: "ip_sharing",
          severity: "medium",
          detail: "Logged in from same IP as: alice",
          detectedAt: "2026-07-01T00:00:00.000Z",
          evidence: { sharedWith: [{ ip: "203.0.113.5", otherUsername: "alice" }] },
        },
      ],
    });

    const groups = buildMatchGroups([a, b]);

    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].isNetworkOnly).toBe(true);
  });

  it("marks a group as not network-only when any member has a stronger corroborating flag", () => {
    const a = entry({
      _id: "charA",
      userId: "userA",
      username: "alice",
      highestSeverity: "medium",
      flags: [
        {
          type: "ip_sharing",
          severity: "medium",
          detail: "Logged in from same IP as: bob",
          detectedAt: "2026-07-01T00:00:00.000Z",
          evidence: { sharedWith: [{ ip: "203.0.113.5", otherUsername: "bob" }] },
        },
      ],
    });
    const b = entry({
      _id: "charB",
      userId: "userB",
      username: "bob",
      highestSeverity: "high",
      flags: [
        {
          type: "ip_sharing",
          severity: "medium",
          detail: "Logged in from same IP as: alice",
          detectedAt: "2026-07-01T00:00:00.000Z",
          evidence: { sharedWith: [{ ip: "203.0.113.5", otherUsername: "alice" }] },
        },
        {
          type: "shared_tracking_cookie",
          severity: "high",
          detail: "Same tracking cookie as: carol",
          detectedAt: "2026-07-01T00:00:00.000Z",
          evidence: { sharedWith: [{ userId: "userC", username: "carol" }] },
        },
      ],
    });
    const c = entry({ _id: "charC", userId: "userC", username: "carol", highestSeverity: "high" });

    const groups = buildMatchGroups([a, b, c]);

    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
    expect(groups[0].isNetworkOnly).toBe(false);
    expect(groups[0].highestSeverity).toBe("high");
  });

  it("does not merge unrelated accounts", () => {
    const a = entry({ _id: "charA", userId: "userA", username: "alice" });
    const b = entry({ _id: "charB", userId: "userB", username: "bob" });

    const groups = buildMatchGroups([a, b]);

    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.members.length === 1)).toBe(true);
  });

  it("sorts groups by highest severity then by member count", () => {
    const low = entry({ _id: "charA", userId: "userA", username: "alice", highestSeverity: "low" });
    const highPair1 = entry({
      _id: "charB",
      userId: "userB",
      username: "bob",
      highestSeverity: "high",
      flags: [
        {
          type: "shared_fingerprint",
          severity: "high",
          detail: "x",
          detectedAt: "2026-07-01T00:00:00.000Z",
          evidence: { sharedWith: [{ userId: "userC", username: "carol" }] },
        },
      ],
    });
    const highPair2 = entry({
      _id: "charC",
      userId: "userC",
      username: "carol",
      highestSeverity: "high",
    });

    const groups = buildMatchGroups([low, highPair1, highPair2]);

    expect(groups[0].highestSeverity).toBe("high");
    expect(groups[0].members).toHaveLength(2);
    expect(groups[1].highestSeverity).toBe("low");
  });
});
