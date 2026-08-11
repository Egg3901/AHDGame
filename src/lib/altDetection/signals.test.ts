import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  ALT_SIGNAL_REGISTRY,
  getSignalDefinition,
  isDegenerateFingerprint,
  isDisposableEmailDomain,
  isSystemGeneratedEmail,
  FINGERPRINT_COMMONNESS_CEILING,
  maskIp,
  normalizeEmailAlias,
  subnet24,
  type AltCandidateFacet,
} from "./signals";

const NOW = new Date("2026-07-20T12:00:00Z");

function facet(overrides: Partial<AltCandidateFacet> & { userId: ObjectId }): AltCandidateFacet {
  return {
    username: "user",
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

describe("ALT_SIGNAL_REGISTRY", () => {
  it("has exactly the 14 plan §3.2 signals plus the 7 forensics-v2 additions, each with a valid default weight", () => {
    const types = ALT_SIGNAL_REGISTRY.map((s) => s.type).sort();
    expect(types).toEqual(
      [
        "activity_rhythm",
        "session_handoff",
        "behavioral_similarity",
        "cf_tls_fingerprint",
        "coordinated_funding",
        "coordinated_login_timing",
        "device_fingerprint_exact",
        "device_fingerprint_fuzzy",
        "deviceKey_exact",
        "email_alias_match",
        "email_pattern_family",
        "impossible_travel",
        "ip_exact_nonCF",
        "ip_intelligence",
        "login_time_cluster",
        "oauth_shared",
        "payment_correlation",
        "referral_link",
        "subnet_/24_share",
        "trackingId_exact",
        "wire_graph_link",
      ].sort()
    );
    for (const def of ALT_SIGNAL_REGISTRY) {
      expect(def.defaultWeight).toBeGreaterThan(0);
      expect(def.defaultWeight).toBeLessThanOrEqual(1);
    }
  });
});

describe("oauth_shared", () => {
  const def = getSignalDefinition("oauth_shared")!;

  it("matches on shared discordId", () => {
    const a = facet({ userId: new ObjectId(), discordId: "d1" });
    const b = facet({ userId: new ObjectId(), discordId: "d1" });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.97);
  });

  it("matches on shared googleEmail case-insensitively and masks it in evidence", () => {
    const a = facet({ userId: new ObjectId(), googleEmail: "Alt@Example.com" });
    const b = facet({ userId: new ObjectId(), googleEmail: "alt@example.com" });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.97);
    expect(match?.evidence).not.toContain("Alt@Example.com");
  });

  it("does not match when no oauth identity is shared", () => {
    const a = facet({ userId: new ObjectId(), discordId: "d1" });
    const b = facet({ userId: new ObjectId(), discordId: "d2" });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("device_fingerprint_exact", () => {
  const def = getSignalDefinition("device_fingerprint_exact")!;

  it("matches at full weight on a real shared fingerprint", () => {
    const a = facet({ userId: new ObjectId(), fingerprints: ["abc123realhash"] });
    const b = facet({ userId: new ObjectId(), fingerprints: ["abc123realhash"] });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.95);
  });

  it("guards degenerate/fallback fingerprints to weight 0 (not null)", () => {
    const a = facet({ userId: new ObjectId(), fingerprints: ["server-side"] });
    const b = facet({ userId: new ObjectId(), fingerprints: ["server-side"] });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match).not.toBeNull();
    expect(match?.weight).toBe(0);
    expect(match?.evidence).toMatch(/degenerate/i);
  });

  it("does not match when fingerprints differ", () => {
    const a = facet({ userId: new ObjectId(), fingerprints: ["hash-a"] });
    const b = facet({ userId: new ObjectId(), fingerprints: ["hash-b"] });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("isDegenerateFingerprint", () => {
  it("flags the known low-entropy/fallback set", () => {
    expect(isDegenerateFingerprint("server-side")).toBe(true);
    expect(isDegenerateFingerprint("")).toBe(true);
    expect(isDegenerateFingerprint(undefined)).toBe(true);
    expect(isDegenerateFingerprint("a-real-64-char-hash")).toBe(false);
  });
});

describe("deviceKey_exact / trackingId_exact", () => {
  it("deviceKey_exact matches equal, non-empty device keys", () => {
    const def = getSignalDefinition("deviceKey_exact")!;
    const a = facet({ userId: new ObjectId(), deviceKey: "dk-1" });
    const b = facet({ userId: new ObjectId(), deviceKey: "dk-1" });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)?.weight).toBe(0.93);
  });

  it("trackingId_exact matches equal, non-empty tracking ids", () => {
    const def = getSignalDefinition("trackingId_exact")!;
    const a = facet({ userId: new ObjectId(), trackingId: "tid-1" });
    const b = facet({ userId: new ObjectId(), trackingId: "tid-1" });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)?.weight).toBe(0.9);
  });
});

describe("device_fingerprint_fuzzy", () => {
  const def = getSignalDefinition("device_fingerprint_fuzzy")!;
  const components = { canvas: "c1", webglRenderer: "w1", audio: "a1", fonts: "f1" };

  it("matches on anchor equality when no exact fingerprint match exists", () => {
    const a = facet({ userId: new ObjectId(), fingerprintComponents: components });
    const b = facet({
      userId: new ObjectId(),
      fingerprintComponents: { ...components, fonts: "different-font-list" },
    });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.55);
  });

  it("defers to the exact signal when a strong exact fingerprint already matched", () => {
    const a = facet({
      userId: new ObjectId(),
      fingerprints: ["shared-hash"],
      fingerprintComponents: components,
    });
    const b = facet({
      userId: new ObjectId(),
      fingerprints: ["shared-hash"],
      fingerprintComponents: components,
    });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("ip_exact_nonCF", () => {
  const def = getSignalDefinition("ip_exact_nonCF")!;
  const residentialIp = "198.51.100.42"; // TEST-NET-2, not a Cloudflare range
  const cfEdgeIp = "104.16.1.1"; // inside 104.16.0.0/13

  it("matches at full weight on a shared residential IP", () => {
    const a = facet({ userId: new ObjectId(), ips: [{ ip: residentialIp, at: NOW }] });
    const b = facet({ userId: new ObjectId(), ips: [{ ip: residentialIp, at: NOW }] });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.35);
    expect(match?.evidence).not.toContain(residentialIp);
  });

  it("guards a shared Cloudflare-edge IP to weight 0", () => {
    const a = facet({ userId: new ObjectId(), ips: [{ ip: cfEdgeIp, at: NOW }] });
    const b = facet({ userId: new ObjectId(), ips: [{ ip: cfEdgeIp, at: NOW }] });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match).not.toBeNull();
    expect(match?.weight).toBe(0);
    expect(match?.evidence).toMatch(/cloudflare/i);
  });

  it("caps a shared datacenter/CGNAT IP to 0.15", () => {
    const a = facet({
      userId: new ObjectId(),
      ips: [{ ip: residentialIp, at: NOW, isDatacenterOrCgnat: true }],
    });
    const b = facet({ userId: new ObjectId(), ips: [{ ip: residentialIp, at: NOW }] });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.15);
  });

  it("does not match when no IP is shared", () => {
    const a = facet({ userId: new ObjectId(), ips: [{ ip: "1.2.3.4", at: NOW }] });
    const b = facet({ userId: new ObjectId(), ips: [{ ip: "5.6.7.8", at: NOW }] });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("subnet_/24_share", () => {
  const def = getSignalDefinition("subnet_/24_share")!;

  it("matches when IPs share a /24 but are not identical", () => {
    const a = facet({ userId: new ObjectId(), ips: [{ ip: "198.51.100.10", at: NOW }] });
    const b = facet({ userId: new ObjectId(), ips: [{ ip: "198.51.100.200", at: NOW }] });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.15);
  });

  it("does not fire when an exact non-CF IP match already exists (superseded)", () => {
    const a = facet({ userId: new ObjectId(), ips: [{ ip: "198.51.100.10", at: NOW }] });
    const b = facet({ userId: new ObjectId(), ips: [{ ip: "198.51.100.10", at: NOW }] });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("coordinated_funding", () => {
  const def = getSignalDefinition("coordinated_funding")!;

  it("matches a donor/recipient pair through the same party within 3 days", () => {
    const uidA = new ObjectId();
    const uidB = new ObjectId();
    const a = facet({
      userId: uidA,
      fundingEvents: [
        { role: "donor", counterpartUserId: uidB, partyId: "party-1", amount: 1000, at: NOW },
      ],
    });
    const b = facet({
      userId: uidB,
      fundingEvents: [
        {
          role: "recipient",
          counterpartUserId: uidA,
          partyId: "party-1",
          amount: 900,
          at: new Date(NOW.getTime() + 6 * 3_600_000),
        },
      ],
    });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.6);
  });

  it("does not match outside the 3-day window", () => {
    const uidA = new ObjectId();
    const uidB = new ObjectId();
    const a = facet({
      userId: uidA,
      fundingEvents: [
        { role: "donor", counterpartUserId: uidB, partyId: "party-1", amount: 1000, at: NOW },
      ],
    });
    const b = facet({
      userId: uidB,
      fundingEvents: [
        {
          role: "recipient",
          counterpartUserId: uidA,
          partyId: "party-1",
          amount: 900,
          at: new Date(NOW.getTime() + 10 * 24 * 3_600_000),
        },
      ],
    });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("wire_graph_link", () => {
  it("matches a direct wire edge between the pair", () => {
    const def = getSignalDefinition("wire_graph_link")!;
    const uidA = new ObjectId();
    const uidB = new ObjectId();
    const a = facet({
      userId: uidA,
      wireEdges: [{ counterpartUserId: uidB, count: 3, totalAmount: 5000, lastAt: NOW }],
    });
    const b = facet({ userId: uidB });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.35);
  });
});

describe("coordinated_login_timing", () => {
  const def = getSignalDefinition("coordinated_login_timing")!;

  it("requires 3+ logins within a 15-minute window", () => {
    const base = NOW.getTime();
    const aTimes = [0, 1, 2].map((i) => new Date(base + i * 3_600_000));
    const bTimes = [0, 1, 2].map((i) => new Date(base + i * 3_600_000 + 5 * 60_000));
    const a = facet({ userId: new ObjectId(), loginTimestamps: aTimes });
    const b = facet({ userId: new ObjectId(), loginTimestamps: bTimes });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.35);
  });

  it("does not match on fewer than 3 co-occurrences", () => {
    const base = NOW.getTime();
    const a = facet({ userId: new ObjectId(), loginTimestamps: [new Date(base)] });
    const b = facet({ userId: new ObjectId(), loginTimestamps: [new Date(base + 60_000)] });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("login_time_cluster", () => {
  const def = getSignalDefinition("login_time_cluster")!;

  it("matches 5+ distinct days within 30 min spanning >=7 days", () => {
    const base = new Date("2026-06-01T09:00:00Z").getTime();
    const dayMs = 24 * 3_600_000;
    const days = [0, 2, 4, 6, 8]; // spans 8 days, 5 distinct days
    const aTimes = days.map((d) => new Date(base + d * dayMs));
    const bTimes = days.map((d) => new Date(base + d * dayMs + 10 * 60_000));
    const a = facet({ userId: new ObjectId(), loginTimestamps: aTimes });
    const b = facet({ userId: new ObjectId(), loginTimestamps: bTimes });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.3);
  });

  it("does not match fewer than 5 distinct days", () => {
    const base = new Date("2026-06-01T09:00:00Z").getTime();
    const dayMs = 24 * 3_600_000;
    const days = [0, 2, 4];
    const aTimes = days.map((d) => new Date(base + d * dayMs));
    const bTimes = days.map((d) => new Date(base + d * dayMs + 5 * 60_000));
    const a = facet({ userId: new ObjectId(), loginTimestamps: aTimes });
    const b = facet({ userId: new ObjectId(), loginTimestamps: bTimes });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("behavioral_similarity", () => {
  it("matches on a shared behavioral observation", () => {
    const def = getSignalDefinition("behavioral_similarity")!;
    const uidA = new ObjectId();
    const uidB = new ObjectId();
    const a = facet({
      userId: uidA,
      behavioral: [
        { counterpartUserId: uidB, kind: "party_bloc_switch", detail: "switched to Reform bloc" },
      ],
    });
    const b = facet({ userId: uidB });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.3);
  });
});

describe("email_pattern_family", () => {
  const def = getSignalDefinition("email_pattern_family")!;

  it("matches related local-parts on the same domain", () => {
    const a = facet({ userId: new ObjectId(), email: "jsmith1@example.com" });
    const b = facet({ userId: new ObjectId(), email: "jsmith2@example.com" });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.3);
    expect(match?.evidence).not.toContain("jsmith1@example.com");
  });

  it("does not match across different domains", () => {
    const a = facet({ userId: new ObjectId(), email: "jsmith1@example.com" });
    const b = facet({ userId: new ObjectId(), email: "jsmith2@other.com" });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });

  it("does not match unrelated local-parts", () => {
    const a = facet({ userId: new ObjectId(), email: "alice@example.com" });
    const b = facet({ userId: new ObjectId(), email: "bob@example.com" });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("referral_link", () => {
  it("matches a direct referredBy relationship in either direction", () => {
    const def = getSignalDefinition("referral_link")!;
    const uidA = new ObjectId();
    const uidB = new ObjectId();
    const a = facet({ userId: uidA, referredBy: uidB });
    const b = facet({ userId: uidB });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.15);
  });
});

describe("ip_intelligence", () => {
  const def = getSignalDefinition("ip_intelligence")!;

  it("matches distinct IPs sharing a hosting/VPN ASN", () => {
    const a = facet({
      userId: new ObjectId(),
      ips: [
        {
          ip: "203.0.113.10",
          at: NOW,
          isDatacenterOrCgnat: true,
          asn: "AS12345 Example Hosting",
        },
      ],
    });
    const b = facet({
      userId: new ObjectId(),
      ips: [
        {
          ip: "198.51.100.99",
          at: NOW,
          isDatacenterOrCgnat: true,
          asn: "AS12345 Example Hosting",
        },
      ],
    });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.2);
    expect(match?.evidence).toMatch(/AS12345/);
  });

  it("does not match residential (non-datacenter) IPs even on the same ASN", () => {
    const a = facet({
      userId: new ObjectId(),
      ips: [{ ip: "203.0.113.10", at: NOW, asn: "AS7018 Residential ISP" }],
    });
    const b = facet({
      userId: new ObjectId(),
      ips: [{ ip: "198.51.100.99", at: NOW, asn: "AS7018 Residential ISP" }],
    });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });

  it("does not double-fire when an exact non-CF IP match already exists", () => {
    const a = facet({
      userId: new ObjectId(),
      ips: [
        { ip: "203.0.113.10", at: NOW, isDatacenterOrCgnat: true, asn: "AS12345 Example Hosting" },
      ],
    });
    const b = facet({
      userId: new ObjectId(),
      ips: [
        { ip: "203.0.113.10", at: NOW, isDatacenterOrCgnat: true, asn: "AS12345 Example Hosting" },
      ],
    });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });

  it("guards a shared Cloudflare-edge IP to no match, same as ip_exact_nonCF", () => {
    const cfEdgeIp = "104.16.1.1"; // inside 104.16.0.0/13
    const a = facet({
      userId: new ObjectId(),
      ips: [{ ip: cfEdgeIp, at: NOW, isDatacenterOrCgnat: true, asn: "AS13335 Cloudflare" }],
    });
    const b = facet({
      userId: new ObjectId(),
      ips: [{ ip: "104.16.2.2", at: NOW, isDatacenterOrCgnat: true, asn: "AS13335 Cloudflare" }],
    });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("impossible_travel", () => {
  const def = getSignalDefinition("impossible_travel")!;
  // ~9,600km apart (roughly London <-> Tokyo), which at 900km/h needs >~10.7h.
  const london = { lat: 51.5074, lon: -0.1278 };
  const tokyo = { lat: 35.6762, lon: 139.6503 };

  it("matches when two accounts' geolocated logins imply an impossible travel speed", () => {
    const a = facet({
      userId: new ObjectId(),
      ips: [{ ip: "198.51.100.1", at: NOW, geo: london }],
    });
    const b = facet({
      userId: new ObjectId(),
      ips: [{ ip: "203.0.113.1", at: new Date(NOW.getTime() + 2 * 3_600_000), geo: tokyo }],
    });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match).not.toBeNull();
    expect(match?.weight).toBe(0.5);
    expect(match?.evidence).toMatch(/km\/h/);
  });

  it("does not match the same far-apart pair given a plausible travel window", () => {
    const a = facet({
      userId: new ObjectId(),
      ips: [{ ip: "198.51.100.1", at: NOW, geo: london }],
    });
    const b = facet({
      userId: new ObjectId(),
      ips: [{ ip: "203.0.113.1", at: new Date(NOW.getTime() + 48 * 3_600_000), geo: tokyo }],
    });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });

  it("is a no-op (scaffold) when geo is not populated on either observation", () => {
    const a = facet({ userId: new ObjectId(), ips: [{ ip: "198.51.100.1", at: NOW }] });
    const b = facet({
      userId: new ObjectId(),
      ips: [{ ip: "203.0.113.1", at: new Date(NOW.getTime() + 3_600_000) }],
    });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });

  it("does not match nearby locations regardless of timing", () => {
    const a = facet({
      userId: new ObjectId(),
      ips: [{ ip: "198.51.100.1", at: NOW, geo: { lat: 51.5074, lon: -0.1278 } }],
    });
    const b = facet({
      userId: new ObjectId(),
      ips: [
        {
          ip: "203.0.113.1",
          at: new Date(NOW.getTime() + 20 * 60_000),
          geo: { lat: 51.51, lon: -0.13 }, // a couple km away, still London
        },
      ],
    });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("email_alias_match", () => {
  const def = getSignalDefinition("email_alias_match")!;

  it("matches Gmail dot+plus alias variants of the same inbox", () => {
    const a = facet({ userId: new ObjectId(), email: "a.b+work@gmail.com" });
    const b = facet({ userId: new ObjectId(), email: "ab@gmail.com" });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.85);
    expect(match?.evidence).not.toContain("a.b+work@gmail.com");
  });

  it("treats googlemail.com as a Gmail alias domain", () => {
    const a = facet({ userId: new ObjectId(), email: "j.doe@googlemail.com" });
    const b = facet({ userId: new ObjectId(), email: "jdoe@gmail.com" });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.85);
  });

  it("matches +tag stripping on a non-Gmail domain but respects dots as significant", () => {
    const a = facet({ userId: new ObjectId(), email: "jane.doe+alt@example.com" });
    const bSameDots = facet({ userId: new ObjectId(), email: "jane.doe@example.com" });
    expect(def.evaluate(a, bSameDots, def.defaultWeight, NOW)?.weight).toBe(0.85);

    const bDifferentDots = facet({ userId: new ObjectId(), email: "janedoe@example.com" });
    expect(def.evaluate(a, bDifferentDots, def.defaultWeight, NOW)).toBeNull();
  });

  it("flags a shared disposable-email domain in the evidence", () => {
    const a = facet({ userId: new ObjectId(), email: "burner+1@mailinator.com" });
    const b = facet({ userId: new ObjectId(), email: "burner@mailinator.com" });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.evidence).toMatch(/disposable/i);
  });

  it("does not match unrelated addresses", () => {
    const a = facet({ userId: new ObjectId(), email: "alice@example.com" });
    const b = facet({ userId: new ObjectId(), email: "bob@example.com" });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });

  it("does not match when either account has no email on file", () => {
    const a = facet({ userId: new ObjectId(), email: "alice@example.com" });
    const b = facet({ userId: new ObjectId() });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("isDisposableEmailDomain / normalizeEmailAlias helpers", () => {
  it("flags known disposable domains and is case-insensitive", () => {
    expect(isDisposableEmailDomain("mailinator.com")).toBe(true);
    expect(isDisposableEmailDomain("MAILINATOR.COM")).toBe(true);
    expect(isDisposableEmailDomain("gmail.com")).toBe(false);
  });

  it("normalizeEmailAlias collapses gmail dots/plus and canonicalizes googlemail.com", () => {
    expect(normalizeEmailAlias("a.b.c+tag@gmail.com")).toEqual({
      local: "abc",
      domain: "gmail.com",
    });
    expect(normalizeEmailAlias("a.b@googlemail.com")).toEqual({ local: "ab", domain: "gmail.com" });
  });

  it("normalizeEmailAlias only strips +tag (keeps dots) on non-gmail domains", () => {
    expect(normalizeEmailAlias("a.b+tag@example.com")).toEqual({
      local: "a.b",
      domain: "example.com",
    });
  });

  it("normalizeEmailAlias returns null for an unparseable address", () => {
    expect(normalizeEmailAlias("not-an-email")).toBeNull();
  });
});

describe("payment_correlation", () => {
  const def = getSignalDefinition("payment_correlation")!;

  it("matches on a shared Patreon supporter id", () => {
    const a = facet({ userId: new ObjectId(), patreonUserId: "patreon-cust-123" });
    const b = facet({ userId: new ObjectId(), patreonUserId: "patreon-cust-123" });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.92);
  });

  it("matches on a shared Stripe customer id", () => {
    const a = facet({ userId: new ObjectId(), stripeCustomerId: "cus_ABC123" });
    const b = facet({ userId: new ObjectId(), stripeCustomerId: "cus_ABC123" });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.92);
  });

  it("does not match when payment identities differ or are absent", () => {
    const a = facet({ userId: new ObjectId(), patreonUserId: "patreon-cust-123" });
    const b = facet({ userId: new ObjectId(), patreonUserId: "patreon-cust-456" });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
    const c = facet({ userId: new ObjectId() });
    const d = facet({ userId: new ObjectId() });
    expect(def.evaluate(c, d, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("cf_tls_fingerprint", () => {
  const def = getSignalDefinition("cf_tls_fingerprint")!;

  it("matches on a shared JA4/JA3 TLS fingerprint and masks it in evidence", () => {
    const a = facet({ userId: new ObjectId(), cfTlsFingerprints: ["t13d1516h2_8daaf6152771"] });
    const b = facet({ userId: new ObjectId(), cfTlsFingerprints: ["t13d1516h2_8daaf6152771"] });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match?.weight).toBe(0.75);
    expect(match?.evidence).not.toContain("t13d1516h2_8daaf6152771");
  });

  it("does not match when TLS fingerprints differ", () => {
    const a = facet({ userId: new ObjectId(), cfTlsFingerprints: ["fp-a"] });
    const b = facet({ userId: new ObjectId(), cfTlsFingerprints: ["fp-b"] });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });

  it("does not match when neither account has a captured TLS fingerprint (graceful degradation)", () => {
    const a = facet({ userId: new ObjectId() });
    const b = facet({ userId: new ObjectId() });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });

  it("matches when either account has multiple historical TLS fingerprints and any one overlaps", () => {
    const a = facet({ userId: new ObjectId(), cfTlsFingerprints: ["fp-old", "fp-new"] });
    const b = facet({ userId: new ObjectId(), cfTlsFingerprints: ["fp-new"] });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match).not.toBeNull();
  });
});

// ─── forensics-v2 Wave 3: behavior signals ─────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

/** Dense activity every 5 minutes across `[fromMin, toMin]` on each of
 * `days` consecutive days, anchored at `hour` UTC. */
function dailyWindow(hour: number, days: number, fromMin: number, toMin: number): Date[] {
  const base = Date.UTC(2026, 5, 1, hour, 0, 0);
  const out: Date[] = [];
  for (let d = 0; d < days; d++) {
    for (let m = fromMin; m <= toMin; m += 5) {
      out.push(new Date(base + d * DAY_MS + m * MIN_MS));
    }
  }
  return out;
}

describe("signal: activity_rhythm", () => {
  const def = getSignalDefinition("activity_rhythm")!;

  it("matches two accounts with near-identical concentrated schedules", () => {
    const a = facet({ userId: new ObjectId(), activityTimestamps: dailyWindow(2, 10, 0, 20) });
    const b = facet({ userId: new ObjectId(), activityTimestamps: dailyWindow(2, 10, 0, 20) });
    const match = def.evaluate(a, b, def.defaultWeight, NOW);
    expect(match).not.toBeNull();
    expect(match!.weight).toBe(def.defaultWeight);
    expect(match!.evidence).toMatch(/activity rhythm/i);
  });

  it("does NOT match two accounts on opposite schedules", () => {
    const a = facet({ userId: new ObjectId(), activityTimestamps: dailyWindow(2, 10, 0, 20) });
    const b = facet({ userId: new ObjectId(), activityTimestamps: dailyWindow(15, 10, 0, 20) });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });

  it("does NOT match diffuse always-on accounts, however similar — the guard that keeps this off half the playerbase", () => {
    const spread: Date[] = [];
    for (let d = 0; d < 6; d++) {
      for (let hour = 0; hour < 24; hour++) {
        spread.push(new Date(Date.UTC(2026, 5, 1 + d, hour, 0, 0)));
      }
    }
    const a = facet({ userId: new ObjectId(), activityTimestamps: [...spread] });
    const b = facet({ userId: new ObjectId(), activityTimestamps: [...spread] });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });

  it("does NOT match when either side is below the event floor", () => {
    const a = facet({ userId: new ObjectId(), activityTimestamps: dailyWindow(2, 10, 0, 20) });
    const b = facet({ userId: new ObjectId(), activityTimestamps: dailyWindow(2, 2, 0, 5) });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });

  it("falls back to login timestamps when no dense activity timeline was assembled", () => {
    // Same schedule, expressed only as logins — enough of them to clear the
    // floor. The signal must not silently require `activityTimestamps`.
    const logins = dailyWindow(2, 10, 0, 20);
    const a = facet({ userId: new ObjectId(), loginTimestamps: logins });
    const b = facet({ userId: new ObjectId(), loginTimestamps: [...logins] });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).not.toBeNull();
  });

  it("returns null rather than throwing for accounts with no timestamps at all", () => {
    const a = facet({ userId: new ObjectId() });
    const b = facet({ userId: new ObjectId() });
    expect(def.evaluate(a, b, def.defaultWeight, NOW)).toBeNull();
  });
});

describe("signal: session_handoff", () => {
  const def = getSignalDefinition("session_handoff")!;

  /** A plays 18:00-18:20, B picks up 18:25-18:45, once a day. */
  function alternating(days: number) {
    const a: Date[] = [];
    const b: Date[] = [];
    const base = Date.UTC(2026, 5, 1, 18, 0, 0);
    for (let d = 0; d < days; d++) {
      const day = base + d * DAY_MS;
      for (let m = 0; m <= 20; m += 5) a.push(new Date(day + m * MIN_MS));
      for (let m = 25; m <= 45; m += 5) b.push(new Date(day + m * MIN_MS));
    }
    return { a, b };
  }

  it("matches a clean alternating pattern with no concurrent time", () => {
    const { a, b } = alternating(6);
    const fa = facet({ userId: new ObjectId(), activityTimestamps: a });
    const fb = facet({ userId: new ObjectId(), activityTimestamps: b });
    const match = def.evaluate(fa, fb, def.defaultWeight, NOW);
    expect(match).not.toBeNull();
    expect(match!.weight).toBe(def.defaultWeight);
    expect(match!.evidence).toMatch(/session handoffs/i);
    expect(match!.evidence).toMatch(/one operator alternating/i);
  });

  it("emits a ZERO-weight, ruled-out note when the accounts overlapped despite handing off", () => {
    // Same alternation, but B starts before A stops on every cycle.
    const a: Date[] = [];
    const b: Date[] = [];
    const base = Date.UTC(2026, 5, 1, 18, 0, 0);
    for (let d = 0; d < 4; d++) {
      const day = base + d * DAY_MS;
      for (let m = 0; m <= 20; m += 5) a.push(new Date(day + m * MIN_MS));
      for (let m = 60; m <= 80; m += 5) a.push(new Date(day + m * MIN_MS));
      for (let m = 15; m <= 55; m += 5) b.push(new Date(day + m * MIN_MS));
      for (let m = 90; m <= 130; m += 5) b.push(new Date(day + m * MIN_MS));
    }
    const fa = facet({ userId: new ObjectId(), activityTimestamps: a });
    const fb = facet({ userId: new ObjectId(), activityTimestamps: b });
    const match = def.evaluate(fa, fb, def.defaultWeight, NOW);
    expect(match).not.toBeNull();
    expect(match!.weight).toBe(0);
    expect(match!.evidence).toMatch(/ruled out/i);
  });

  it("stays silent (null, not a zero-weight note) for quiet pairs that simply never alternate", () => {
    // Both play, but 12 hours apart — no handoff is possible. Emitting a
    // note here would bury the UI in "we checked and found nothing".
    const fa = facet({ userId: new ObjectId(), activityTimestamps: dailyWindow(2, 6, 0, 20) });
    const fb = facet({ userId: new ObjectId(), activityTimestamps: dailyWindow(14, 6, 0, 20) });
    expect(def.evaluate(fa, fb, def.defaultWeight, NOW)).toBeNull();
  });

  it("does not fire on too few sessions even when every one of them hands off", () => {
    const { a, b } = alternating(2);
    const fa = facet({ userId: new ObjectId(), activityTimestamps: a });
    const fb = facet({ userId: new ObjectId(), activityTimestamps: b });
    expect(def.evaluate(fa, fb, def.defaultWeight, NOW)).toBeNull();
  });

  it("returns null rather than throwing when either account has no activity", () => {
    const { a } = alternating(6);
    const fa = facet({ userId: new ObjectId(), activityTimestamps: a });
    const fb = facet({ userId: new ObjectId() });
    expect(def.evaluate(fa, fb, def.defaultWeight, NOW)).toBeNull();
  });

  it("dates the evidence to the most recent session, not the run clock", () => {
    const { a, b } = alternating(6);
    const fa = facet({ userId: new ObjectId(), activityTimestamps: a });
    const fb = facet({ userId: new ObjectId(), activityTimestamps: b });
    const match = def.evaluate(fa, fb, def.defaultWeight, NOW)!;
    const latest = Math.max(...[...a, ...b].map((t) => t.getTime()));
    expect(match.detectedAt.getTime()).toBe(latest);
  });
});

describe("mask helpers", () => {
  it("maskIp hides the last IPv4 octet", () => {
    expect(maskIp("198.51.100.42")).toBe("198.51.100.xxx");
  });

  it("subnet24 extracts the first three IPv4 octets and returns null for IPv6", () => {
    expect(subnet24("198.51.100.42")).toBe("198.51.100");
    expect(subnet24("2606:4700::1")).toBeNull();
  });
});

// ── False-positive guards ────────────────────────────────────────────────────
// Both of these fired on the live 1953 world and bonded 207 legitimate accounts
// into a single 95.6% "ring" whose operator was the game owner. The other
// members were ordinary Discord players on mobile handsets.

describe("system-generated placeholder emails are not a family signal", () => {
  const def = getSignalDefinition("email_pattern_family")!;

  it("does not match two Discord OAuth placeholders", () => {
    // Discord sign-up mints `discord<snowflake>@discord.local`. Stripping the
    // trailing digits collapses every one of them to the same stem, so this
    // used to link any two Discord users in the game at 0.3.
    const a = facet({
      userId: new ObjectId(),
      email: "discord910000000000000001@discord.local",
    });
    const b = facet({ userId: new ObjectId(), email: "discord910000000000000002@discord.local" });
    expect(def.evaluate(a, b, 0.3, NOW)).toBeNull();
  });

  it("still matches a genuine self-chosen email family", () => {
    const a = facet({ userId: new ObjectId(), email: "altfarm1@gmail.com" });
    const b = facet({ userId: new ObjectId(), email: "altfarm2@gmail.com" });
    expect(def.evaluate(a, b, 0.3, NOW)?.weight).toBe(0.3);
  });

  it("flags the placeholder domains", () => {
    expect(isSystemGeneratedEmail("discord123@discord.local")).toBe(true);
    expect(isSystemGeneratedEmail("someone@gmail.com")).toBe(false);
    expect(isSystemGeneratedEmail(undefined)).toBe(false);
  });
});

describe("fingerprints common across the corpus are not ring evidence", () => {
  const def = getSignalDefinition("device_fingerprint_exact")!;
  const SHARED = "16230f0c24aa";

  const a = facet({ userId: new ObjectId(), fingerprints: [SHARED] });
  const b = facet({ userId: new ObjectId(), fingerprints: [SHARED] });

  it("scores 0 when the hash is held by more accounts than the ceiling", () => {
    // Mobile handsets of the same model/OS/browser produce identical hashes.
    const counts = new Map([[SHARED, FINGERPRINT_COMMONNESS_CEILING + 1]]);
    const match = def.evaluate(a, b, 0.95, NOW, { fingerprintCounts: counts });
    expect(match?.weight).toBe(0);
    expect(match?.evidence).toMatch(/common to \d+ accounts/);
  });

  it("keeps full weight when only a couple of accounts share it", () => {
    const counts = new Map([[SHARED, 2]]);
    expect(def.evaluate(a, b, 0.95, NOW, { fingerprintCounts: counts })?.weight).toBe(0.95);
  });

  it("keeps full weight when no corpus context is supplied", () => {
    expect(def.evaluate(a, b, 0.95, NOW)?.weight).toBe(0.95);
  });
});
