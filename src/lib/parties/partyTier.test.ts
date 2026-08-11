import { describe, expect, it } from "vitest";
import {
  MINOR_PARTY_BASE_PS_CAP,
  MINOR_PARTY_PS_CAP_PER_REGION,
  TIER_EARN_REGION_ORG_PCT,
  TIER_LOSE_REGION_ORG_PCT,
  MAJOR_DEMOTION_GRACE_TURNS,
  graduationThreshold,
  demotionThreshold,
  updateEarnedRegions,
  minorPartyPsCap,
  resolvePartyPsCap,
  resolvePartyTier,
  resolveTierTransition,
} from "./partyTier";

describe("resolvePartyTier (legacy fallback)", () => {
  it("uses the stored tier when present", () => {
    expect(resolvePartyTier({ tier: "minor", isDefault: true })).toBe("minor");
    expect(resolvePartyTier({ tier: "major", isDefault: false })).toBe("major");
  });

  it("falls back to major for default parties, minor for custom, when unset", () => {
    expect(resolvePartyTier({ isDefault: true })).toBe("major");
    expect(resolvePartyTier({ isDefault: false })).toBe("minor");
  });
});

describe("tier region thresholds", () => {
  it("graduation = ceil(regions / 3)", () => {
    expect(graduationThreshold(50)).toBe(17); // US
    expect(graduationThreshold(12)).toBe(4); // UK
    expect(graduationThreshold(16)).toBe(6); // DE
    expect(graduationThreshold(8)).toBe(3); // JP
  });

  it("demotion = ceil(2 * regions / 3)", () => {
    expect(demotionThreshold(50)).toBe(34);
    expect(demotionThreshold(12)).toBe(8);
  });
});

describe("updateEarnedRegions (hysteresis: earn ≥20%, lose <10%)", () => {
  it("earns a region at or above the earn threshold", () => {
    const earned = updateEarnedRegions([], new Map([["CA", TIER_EARN_REGION_ORG_PCT]]));
    expect(earned).toEqual(["CA"]);
  });

  it("keeps an earned region while Org stays in the sticky 10–20 band", () => {
    const earned = updateEarnedRegions(["CA"], new Map([["CA", 15]]));
    expect(earned).toContain("CA");
  });

  it("loses an earned region only when Org drops below the lose threshold", () => {
    const stillEarned = updateEarnedRegions(["CA"], new Map([["CA", TIER_LOSE_REGION_ORG_PCT]]));
    expect(stillEarned).toContain("CA"); // exactly at 10 → kept (drop is < 10)
    const lost = updateEarnedRegions(["CA"], new Map([["CA", 9.9]]));
    expect(lost).not.toContain("CA");
  });

  it("does not earn a region in the 10–20 band that was not previously earned", () => {
    const earned = updateEarnedRegions([], new Map([["CA", 15]]));
    expect(earned).not.toContain("CA");
  });

  it("drops an earned region that no longer has an Org entry (presence lost)", () => {
    const earned = updateEarnedRegions(["CA"], new Map());
    expect(earned).not.toContain("CA");
  });

  it("returns a sorted, de-duplicated list", () => {
    const earned = updateEarnedRegions(
      ["TX"],
      new Map([
        ["TX", 25],
        ["CA", 30],
      ])
    );
    expect(earned).toEqual(["CA", "TX"]);
  });
});

describe("minorPartyPsCap", () => {
  it("starts at the base cap with no earned regions", () => {
    expect(minorPartyPsCap(0, 280)).toBe(MINOR_PARTY_BASE_PS_CAP);
  });

  it("grows by the per-region amount", () => {
    expect(minorPartyPsCap(5, 280)).toBe(
      MINOR_PARTY_BASE_PS_CAP + 5 * MINOR_PARTY_PS_CAP_PER_REGION
    );
  });

  it("never exceeds the national cap", () => {
    expect(minorPartyPsCap(100, 280)).toBe(280);
  });
});

describe("resolvePartyPsCap", () => {
  it("major parties get the full national cap", () => {
    expect(resolvePartyPsCap("major", 0, 280)).toBe(280);
  });

  it("minor parties get the footprint-scaled cap", () => {
    expect(resolvePartyPsCap("minor", 5, 280)).toBe(150);
  });
});

describe("resolveTierTransition", () => {
  const regionCount = 12; // UK: graduation 4, demotion 8

  function orgMap(highRegions: number, pct: number): Map<string, number> {
    const m = new Map<string, number>();
    for (let i = 0; i < highRegions; i++) m.set(`R${i}`, pct);
    return m;
  }

  it("promotes a Minor party that reaches 20% in ⌈regions/3⌉ regions", () => {
    const r = resolveTierTransition({
      currentTier: "minor",
      orgByRegion: orgMap(4, 25),
      regionCount,
      warningStartedTurn: null,
      currentTurn: 100,
    });
    expect(r.tier).toBe("major");
    expect(r.reason).toBe("graduated");
  });

  it("leaves a Minor party Minor below the graduation threshold", () => {
    const r = resolveTierTransition({
      currentTier: "minor",
      orgByRegion: orgMap(3, 25),
      regionCount,
      warningStartedTurn: null,
      currentTurn: 100,
    });
    expect(r.tier).toBe("minor");
  });

  it("starts a demotion warning when a Major party is <10% in ⌈2·regions/3⌉ regions", () => {
    // 12 regions, demotion threshold 8: need ≥8 regions below 10%. Give only 4
    // regions any Org at all (8 absent → treated as 0 → below 10%).
    const r = resolveTierTransition({
      currentTier: "major",
      orgByRegion: orgMap(4, 15),
      regionCount,
      warningStartedTurn: null,
      currentTurn: 100,
    });
    expect(r.tier).toBe("major");
    expect(r.reason).toBe("warning-started");
    expect(r.warningStartedTurn).toBe(100);
  });

  it("demotes a Major party when the grace period elapses without recovery", () => {
    const r = resolveTierTransition({
      currentTier: "major",
      orgByRegion: orgMap(4, 15),
      regionCount,
      warningStartedTurn: 100,
      currentTurn: 100 + MAJOR_DEMOTION_GRACE_TURNS,
    });
    expect(r.tier).toBe("minor");
    expect(r.reason).toBe("demoted");
    expect(r.warningStartedTurn).toBeNull();
  });

  it("cancels the warning when the party regains the graduation condition", () => {
    const r = resolveTierTransition({
      currentTier: "major",
      orgByRegion: orgMap(4, 25), // ≥20% in 4 = graduation met
      regionCount,
      warningStartedTurn: 100,
      currentTurn: 150,
    });
    expect(r.tier).toBe("major");
    expect(r.warningStartedTurn).toBeNull();
    expect(r.reason).toBe("warning-cleared");
  });

  it("exempt parties (OPS ruling) stay Major with no warning even when at-risk", () => {
    const r = resolveTierTransition({
      currentTier: "major",
      orgByRegion: orgMap(1, 15), // 11/12 regions below 10% → would be at-risk
      regionCount,
      warningStartedTurn: 100, // had a warning — must be cleared
      currentTurn: 100 + MAJOR_DEMOTION_GRACE_TURNS, // grace elapsed — must NOT demote
      exemptFromDemotion: true,
    });
    expect(r.tier).toBe("major");
    expect(r.warningStartedTurn).toBeNull();
  });

  it("pins an exempt party to Major", () => {
    const r = resolveTierTransition({
      currentTier: "minor",
      orgByRegion: orgMap(0, 0),
      regionCount,
      warningStartedTurn: null,
      currentTurn: 100,
      exemptFromDemotion: true,
    });
    expect(r.tier).toBe("major");
  });
});
