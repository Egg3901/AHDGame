/**
 * Unit tests for CPC priorities, policy alignment, and purge effects.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_CN_PRIORITY_PROFILE,
  validatePriorityProfile,
  computePolicyAlignment,
  scoreToTurnDelta,
  computeTurnDrift,
  PURGE_SEVERITY_DELTA,
  getConfidenceConsequenceLevel,
  CONFIDENCE_CONSEQUENCE_DESCRIPTIONS,
} from "@/lib/turn/rulingPartyPriorities";
import type { PurgeEvent } from "@/lib/turn/rulingPartyPriorities";

describe("CPC Priority Profile", () => {
  it("has valid axis weights that sum to 1.0", () => {
    expect(validatePriorityProfile(DEFAULT_CN_PRIORITY_PROFILE)).toBe(true);
  });
});

describe("Policy Alignment Scoring", () => {
  it("market-liberalization conflicts with state_sector and party_control", () => {
    const result = computePolicyAlignment("market-liberalization");
    expect(result.score).toBeLessThan(0);
    expect(result.conflictingAxes.length).toBeGreaterThan(0);
    expect(result.conflictingAxes.some((a) => a.axisId === "state_sector")).toBe(true);
  });

  it("industrial-investment aligns with CPC priorities", () => {
    const result = computePolicyAlignment("industrial-investment");
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchingAxes.some((a) => a.axisId === "industrial_policy")).toBe(true);
  });

  it("anti-corruption aligns positively", () => {
    const result = computePolicyAlignment("anti-corruption");
    expect(result.score).toBeGreaterThan(30);
  });

  it("unknown category returns neutral score", () => {
    const result = computePolicyAlignment("unknown-category");
    expect(result.score).toBe(0);
    expect(result.matchingAxes).toHaveLength(0);
    expect(result.conflictingAxes).toHaveLength(0);
  });
});

describe("Score to Turn Delta", () => {
  it("converts >= 40 to +1", () => {
    expect(scoreToTurnDelta(40)).toBe(1);
    expect(scoreToTurnDelta(100)).toBe(1);
  });

  it("converts 10–39 to 0 (or +0.25 fractional)", () => {
    expect(scoreToTurnDelta(10)).toBe(0);
    expect(scoreToTurnDelta(39)).toBe(0);
    expect(scoreToTurnDelta(25, true)).toBe(0.25);
  });

  it("converts -9–9 to 0", () => {
    expect(scoreToTurnDelta(0)).toBe(0);
    expect(scoreToTurnDelta(-9)).toBe(0);
    expect(scoreToTurnDelta(9)).toBe(0);
  });

  it("converts -10–-39 to -1", () => {
    expect(scoreToTurnDelta(-10)).toBe(-1);
    expect(scoreToTurnDelta(-39)).toBe(-1);
  });

  it("converts <= -40 to negative severity", () => {
    expect(scoreToTurnDelta(-40)).toBe(-2);
    expect(scoreToTurnDelta(-80)).toBe(-4);
  });
});

describe("Turn Drift Computation", () => {
  it("computes policy drift from multiple categories", () => {
    const input = {
      policyCategories: ["industrial-investment", "market-liberalization", "unknown"],
      activePurgeEvents: [],
    };
    const result = computeTurnDrift(input);
    expect(result.details.policies).toHaveLength(3);
    expect(result.purgeDelta).toBe(0);
  });

  it("includes unprocessed purges in drift", () => {
    const purges: PurgeEvent[] = [
      {
        countryId: "CN",
        severity: "senior",
        reason: "Test purge",
        turn: 10,
        processed: false,
        createdAt: new Date(),
      },
      {
        countryId: "CN",
        severity: "minor",
        reason: "Already processed",
        turn: 9,
        processed: true,
        createdAt: new Date(),
      },
    ];
    const input = { policyCategories: [], activePurgeEvents: purges };
    const result = computeTurnDrift(input);
    expect(result.purgeDelta).toBe(PURGE_SEVERITY_DELTA.senior);
    expect(result.details.purges).toHaveLength(1);
    expect(result.details.purges[0].severity).toBe("senior");
  });

  it("returns zero drift with empty input", () => {
    const result = computeTurnDrift({ policyCategories: [], activePurgeEvents: [] });
    expect(result.totalDelta).toBe(0);
    expect(result.policyDelta).toBe(0);
    expect(result.purgeDelta).toBe(0);
  });
});

describe("popularLegitimacyBleedIntoParty (Phase 3 coupling)", () => {
  it("returns 0 when popular ≥ 30", async () => {
    const { popularLegitimacyBleedIntoParty } = await import("@/lib/turn/rulingPartyPriorities");
    expect(popularLegitimacyBleedIntoParty(30)).toBe(0);
    expect(popularLegitimacyBleedIntoParty(50)).toBe(0);
    expect(popularLegitimacyBleedIntoParty(95)).toBe(0);
  });

  it("returns -0.5 in [15, 30)", async () => {
    const { popularLegitimacyBleedIntoParty } = await import("@/lib/turn/rulingPartyPriorities");
    expect(popularLegitimacyBleedIntoParty(29)).toBe(-0.25);
    expect(popularLegitimacyBleedIntoParty(20)).toBe(-0.25);
    expect(popularLegitimacyBleedIntoParty(15)).toBe(-0.25);
  });

  it("returns -1.0 below 15", async () => {
    const { popularLegitimacyBleedIntoParty } = await import("@/lib/turn/rulingPartyPriorities");
    expect(popularLegitimacyBleedIntoParty(14)).toBe(-0.5);
    expect(popularLegitimacyBleedIntoParty(0)).toBe(-0.5);
  });
});

describe("computeTurnDrift with popularLegitimacy coupling", () => {
  it("ignores popular bleed when popularLegitimacy is undefined", () => {
    const result = computeTurnDrift({
      policyCategories: [],
      activePurgeEvents: [],
    });
    expect(result.popularBleedDelta).toBe(0);
    expect(result.totalDelta).toBe(0);
  });

  it("ignores popular bleed when popular ≥ 30", () => {
    const result = computeTurnDrift({
      policyCategories: [],
      activePurgeEvents: [],
      popularLegitimacy: 50,
    });
    expect(result.popularBleedDelta).toBe(0);
  });

  it("adds -0.25 to totalDelta when popular in [15, 30)", () => {
    const result = computeTurnDrift({
      policyCategories: [],
      activePurgeEvents: [],
      popularLegitimacy: 20,
    });
    expect(result.popularBleedDelta).toBe(-0.25);
    expect(result.totalDelta).toBe(-0.25);
  });

  it("adds -0.5 to totalDelta when popular < 15", () => {
    const result = computeTurnDrift({
      policyCategories: [],
      activePurgeEvents: [],
      popularLegitimacy: 10,
    });
    expect(result.popularBleedDelta).toBe(-0.5);
    expect(result.totalDelta).toBe(-0.5);
  });

  it("composes with policy + purge deltas", () => {
    const result = computeTurnDrift({
      policyCategories: [],
      activePurgeEvents: [
        {
          countryId: "CN",
          severity: "minor",
          reason: "test",
          turn: 1,
          processed: false,
          createdAt: new Date(),
        },
      ],
      popularLegitimacy: 10,
    });
    // purge=-2, popularBleed=-0.5 → total -2.5
    expect(result.purgeDelta).toBe(-2);
    expect(result.popularBleedDelta).toBe(-0.5);
    expect(result.totalDelta).toBe(-2.5);
  });
});

describe("Confidence Consequence Levels", () => {
  it("returns correct levels at thresholds", () => {
    expect(getConfidenceConsequenceLevel(80)).toBe("none");
    expect(getConfidenceConsequenceLevel(49)).toBe("discipline_loss");
    expect(getConfidenceConsequenceLevel(34)).toBe("challenge_risk");
    expect(getConfidenceConsequenceLevel(24)).toBe("appointment_resistance");
    expect(getConfidenceConsequenceLevel(14)).toBe("forced_crisis");
    expect(getConfidenceConsequenceLevel(0)).toBe("forced_crisis");
  });

  it("has descriptions for all levels", () => {
    const levels = [
      "none",
      "discipline_loss",
      "challenge_risk",
      "appointment_resistance",
      "forced_crisis",
    ] as const;
    for (const level of levels) {
      expect(CONFIDENCE_CONSEQUENCE_DESCRIPTIONS[level]).toBeTruthy();
      expect(CONFIDENCE_CONSEQUENCE_DESCRIPTIONS[level].length).toBeGreaterThan(0);
    }
  });
});
