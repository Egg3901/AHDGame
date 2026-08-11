import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { buildAltLinks } from "./buildLinks";
import type { AltCandidateFacet } from "./signals";

const NOW = new Date("2026-07-20T12:00:00Z");

function facet(overrides: Partial<AltCandidateFacet> & { userId: ObjectId }): AltCandidateFacet {
  return {
    fingerprints: [],
    cfTlsFingerprints: [],
    ips: [],
    loginTimestamps: [],
    fundingEvents: [],
    wireEdges: [],
    behavioral: [],
    ...overrides,
  };
}

describe("buildAltLinks", () => {
  it("emits no link for a pair with no matching signals", () => {
    const a = facet({ userId: new ObjectId(), username: "alice" });
    const b = facet({ userId: new ObjectId(), username: "bob" });
    expect(buildAltLinks([a, b], { now: NOW })).toEqual([]);
  });

  it("emits a link with the sorted (userA <= userB) pair and a per-signal breakdown", () => {
    const a = facet({ userId: new ObjectId(), deviceKey: "dk-shared" });
    const b = facet({ userId: new ObjectId(), deviceKey: "dk-shared" });
    const [link] = buildAltLinks([a, b], { now: NOW, turn: 42 });

    expect(link).toBeDefined();
    expect(link.turn).toBe(42);
    expect(link.userA.toString() <= link.userB.toString()).toBe(true);
    expect([link.userA.toString(), link.userB.toString()].sort()).toEqual(
      [a.userId.toString(), b.userId.toString()].sort()
    );
    expect(link.signals).toHaveLength(1);
    expect(link.signals[0].type).toBe("deviceKey_exact");
    expect(link.confidence).toBeCloseTo(0.93, 10);
  });

  it("aggregates multiple matching signals via noisy-OR into one link", () => {
    const a = facet({ userId: new ObjectId(), deviceKey: "dk-shared", trackingId: "tid-shared" });
    const b = facet({ userId: new ObjectId(), deviceKey: "dk-shared", trackingId: "tid-shared" });
    const [link] = buildAltLinks([a, b], { now: NOW });

    const types = link.signals.map((s) => s.type).sort();
    expect(types).toEqual(["deviceKey_exact", "trackingId_exact"]);
    // 1 - (1-0.93)(1-0.90) = 1 - 0.007 = 0.993
    expect(link.confidence).toBeCloseTo(1 - (1 - 0.93) * (1 - 0.9), 10);
  });

  it("applies a custom weight override", () => {
    const a = facet({ userId: new ObjectId(), discordId: "d1" });
    const b = facet({ userId: new ObjectId(), discordId: "d1" });
    const [link] = buildAltLinks([a, b], { now: NOW, weights: { oauth_shared: 0.5 } });
    expect(link.confidence).toBeCloseTo(0.5, 10);
  });

  it("boosts wire_graph_link when corroborated by a shared device signal on the same pair", () => {
    const uidA = new ObjectId();
    const uidB = new ObjectId();
    const a = facet({
      userId: uidA,
      deviceKey: "dk-shared",
      wireEdges: [{ counterpartUserId: uidB, count: 2, totalAmount: 1000, lastAt: NOW }],
    });
    const b = facet({ userId: uidB, deviceKey: "dk-shared" });
    const [link] = buildAltLinks([a, b], { now: NOW });

    const wireSignal = link.signals.find((s) => s.type === "wire_graph_link");
    expect(wireSignal).toBeDefined();
    expect(wireSignal!.weight).toBeGreaterThan(0.35); // base weight boosted
    expect(wireSignal!.evidence).toMatch(/corroborated/i);
  });

  it("escalates referral_link to 0.45 when the referral chain includes a banned sibling", () => {
    const referrer = new ObjectId();
    const referred = new ObjectId();
    const bannedSibling = new ObjectId();

    const a = facet({ userId: referrer, username: "referrer" });
    const b = facet({ userId: referred, username: "referred", referredBy: referrer });
    const c = facet({
      userId: bannedSibling,
      username: "banned-burner",
      referredBy: referrer,
      isBanned: true,
      // give c its own signal so it forms a link too, but that's not what we assert on here
      deviceKey: "unrelated-device",
    });

    const [referredLink] = buildAltLinks([a, b, c], { now: NOW }).filter((l) => {
      const ids = [l.userA.toString(), l.userB.toString()];
      return ids.includes(referrer.toString()) && ids.includes(referred.toString());
    });

    const referralSignal = referredLink.signals.find((s) => s.type === "referral_link");
    expect(referralSignal?.weight).toBe(0.45);
    expect(referralSignal?.evidence).toMatch(/escalated/i);
  });

  it("does not escalate referral_link when no sibling is banned", () => {
    const referrer = new ObjectId();
    const referred = new ObjectId();
    const a = facet({ userId: referrer, username: "referrer" });
    const b = facet({ userId: referred, username: "referred", referredBy: referrer });
    const [link] = buildAltLinks([a, b], { now: NOW });
    const referralSignal = link.signals.find((s) => s.type === "referral_link");
    expect(referralSignal?.weight).toBe(0.15);
  });

  it("drops links at or below minConfidence", () => {
    const a = facet({ userId: new ObjectId(), referredBy: undefined });
    const b = facet({ userId: new ObjectId() });
    a.referredBy = b.userId;
    const links = buildAltLinks([a, b], { now: NOW, minConfidence: 0.9 });
    expect(links).toEqual([]); // referral_link alone (0.15) is below the floor
  });
});
