import { describe, expect, it } from "vitest";
import {
  computeConfidenceHit,
  computeConfidenceRecovery,
  computeLegitimacyDelta,
  computeApprovalNudge,
  computeIdeologyMultiplier,
  classifyTakingPopularity,
  computePrivatizationConfidenceBoost,
  computePrivatizationApprovalNudge,
  computePrivatizationLegitimacyDelta,
} from "./compute";
import { INVESTOR_CONFIDENCE_BASELINE, PRIVATIZATION_CONFIDENCE_BOOST_BASE } from "../constants";

describe("computeConfidenceHit", () => {
  const baseInput = {
    tier: "fair" as const,
    valuationAnchor: 1_000_000,
    compensationAnchor: 1_000_000, // fully paid
    ideologyMultiplier: 1,
    concentrationMultiplier: 1,
    popularity: "unpopular" as const,
  };

  it("fires the base hit even on a fully-paid fair taking (the act scars)", () => {
    const fair = computeConfidenceHit(baseInput);
    expect(fair).toBeGreaterThan(0); // no longer zero — this is the bug fix
  });

  it("a seizure (unpaid) stacks the surcharge on top of the base", () => {
    const fair = computeConfidenceHit(baseInput);
    const seizure = computeConfidenceHit({
      ...baseInput,
      tier: "seizure",
      compensationAnchor: 0,
    });
    expect(seizure).toBeGreaterThan(fair);
  });

  it("escalates with the concentration multiplier", () => {
    const low = computeConfidenceHit({ ...baseInput, concentrationMultiplier: 1 });
    const high = computeConfidenceHit({ ...baseInput, concentrationMultiplier: 2.5 });
    expect(high).toBeGreaterThan(low);
  });

  it("a popular taking takes a smaller base hit than an unpopular one", () => {
    const popular = computeConfidenceHit({ ...baseInput, popularity: "popular" });
    const unpopular = computeConfidenceHit({ ...baseInput, popularity: "unpopular" });
    expect(popular).toBeLessThan(unpopular);
  });

  it("scales with the ideology multiplier", () => {
    const statist = computeConfidenceHit({ ...baseInput, ideologyMultiplier: 0.5 });
    const market = computeConfidenceHit({ ...baseInput, ideologyMultiplier: 1.5 });
    expect(market).toBeGreaterThan(statist);
  });
});

describe("computeConfidenceRecovery", () => {
  it("moves toward baseline by the recovery fraction", () => {
    const next = computeConfidenceRecovery(50);
    expect(next).toBeGreaterThan(50);
    expect(next).toBeLessThan(INVESTOR_CONFIDENCE_BASELINE);
  });
  it("is a fixed point at baseline", () => {
    expect(computeConfidenceRecovery(INVESTOR_CONFIDENCE_BASELINE)).toBeCloseTo(
      INVESTOR_CONFIDENCE_BASELINE,
      5
    );
  });
});

describe("computeIdeologyMultiplier", () => {
  it("is cheaper for statist, costlier for market-liberal, neutral when unknown", () => {
    expect(computeIdeologyMultiplier(-1)).toBeLessThan(1); // fully statist
    expect(computeIdeologyMultiplier(1)).toBeGreaterThan(1); // fully market
    expect(computeIdeologyMultiplier(null)).toBe(1);
  });
});

describe("classifyTakingPopularity", () => {
  it("distress rescue and monopoly break-up are popular", () => {
    expect(classifyTakingPopularity(["distress"])).toBe("popular");
    expect(classifyTakingPopularity(["monopoly"])).toBe("popular");
  });
  it("a plain strategic-sector seizure is unpopular", () => {
    expect(classifyTakingPopularity(["strategic"])).toBe("unpopular");
  });
});

describe("computeLegitimacyDelta", () => {
  it("is negative and scales with tier, ideology, and concentration", () => {
    const seizure = computeLegitimacyDelta({
      tier: "seizure",
      ideologyMultiplier: 1,
      concentrationMultiplier: 1,
    });
    const fair = computeLegitimacyDelta({
      tier: "fair",
      ideologyMultiplier: 1,
      concentrationMultiplier: 1,
    });
    expect(seizure).toBeLessThan(0);
    expect(seizure).toBeLessThan(fair);

    const escalated = computeLegitimacyDelta({
      tier: "seizure",
      ideologyMultiplier: 1,
      concentrationMultiplier: 2.5,
    });
    expect(escalated).toBeLessThan(seizure); // more negative at high SOCI
  });
});

describe("computeApprovalNudge", () => {
  const base = {
    tier: "seizure" as const,
    ideologyMultiplier: 1,
    concentrationMultiplier: 1,
  };

  it("an unpopular taking is a penalty that deepens with concentration", () => {
    const low = computeApprovalNudge({ ...base, popularity: "unpopular" });
    const high = computeApprovalNudge({
      ...base,
      popularity: "unpopular",
      concentrationMultiplier: 2.5,
    });
    expect(low).toBeLessThan(0);
    expect(high).toBeLessThan(low); // more negative at high SOCI
  });

  it("a popular taking is a boost at low ownership but flips negative at high SOCI", () => {
    const lowOwnership = computeApprovalNudge({ ...base, popularity: "popular" });
    const highOwnership = computeApprovalNudge({
      ...base,
      popularity: "popular",
      concentrationMultiplier: 3,
    });
    expect(lowOwnership).toBeGreaterThan(0); // still rewarded when the state owns little
    expect(highOwnership).toBeLessThan(0); // the public sours once the state owns everything
  });

  it("a fair-paid taking carries real political weight (flat political tier weight)", () => {
    const fair = Math.abs(
      computeApprovalNudge({
        popularity: "unpopular",
        tier: "fair",
        ideologyMultiplier: 1,
        concentrationMultiplier: 1,
      })
    );
    const seizure = Math.abs(
      computeApprovalNudge({
        popularity: "unpopular",
        tier: "seizure",
        ideologyMultiplier: 1,
        concentrationMultiplier: 1,
      })
    );
    // Fair political cost is ≥ 40% of seizure (the flat POLITICAL_TIER_WEIGHT),
    // not the near-free tenth the confidence weight would give.
    expect(fair).toBeGreaterThanOrEqual(seizure * 0.4);
  });
});

describe("privatization consequence math", () => {
  it("confidence boost is the bounded base (ideology-independent)", () => {
    expect(computePrivatizationConfidenceBoost()).toBe(PRIVATIZATION_CONFIDENCE_BOOST_BASE);
  });
  it("approval nudge is + for a market govt, − for a statist govt, 0 at neutral", () => {
    expect(computePrivatizationApprovalNudge(1.5)).toBeGreaterThan(0);
    expect(computePrivatizationApprovalNudge(0.5)).toBeLessThan(0);
    expect(computePrivatizationApprovalNudge(1)).toBe(0);
  });
  it("legitimacy delta tracks the same ideology direction", () => {
    expect(computePrivatizationLegitimacyDelta(1.5)).toBeGreaterThan(0);
    expect(computePrivatizationLegitimacyDelta(0.5)).toBeLessThan(0);
    expect(computePrivatizationLegitimacyDelta(1)).toBe(0);
  });
});
