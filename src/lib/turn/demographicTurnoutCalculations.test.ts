import { describe, it, expect } from "vitest";
import {
  calculateGOTVSpend,
  calculateSuppressionSpend,
  calculateOrgBuildingSpend,
  calculateNationalGOTVBoost,
  calculateStateGOTVBoost,
  applyBoost,
  calculateMomentumGain,
  calculateNewMomentum,
  applyMomentumDecay,
  calculateCanvassingBoost,
  getDemographicLean,
} from "./demographicTurnoutCalculations";
import type { StateDemographicTurnout } from "@/lib/db/types";

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeTurnoutState(
  modifiers: Record<string, Record<string, number>> = {}
): StateDemographicTurnout {
  return {
    _id: "US-CA",
    countryId: "US",
    modifiers,
    lastDecayApplied: new Date(),
    lastUpdated: new Date(),
  };
}

// ─── calculateGOTVSpend ──────────────────────────────────────────────────────

describe("calculateGOTVSpend", () => {
  it("uses percent-based formula when gotvBudgetPercent > 0", () => {
    // $100k revenue at 10% = $10k spend
    expect(calculateGOTVSpend(100_000, 10, 0)).toBe(10_000);
  });

  it("floors fractional percent spend", () => {
    // $33,333 revenue at 10% = 3333.3 → Math.floor → 3333
    expect(calculateGOTVSpend(33_333, 10, 0)).toBe(3_333);
  });

  it("falls back to flat legacy amount when percent is 0 and flat is set", () => {
    expect(calculateGOTVSpend(100_000, 0, 5_000)).toBe(5_000);
  });

  it("returns 0 when both percent and flat are 0", () => {
    expect(calculateGOTVSpend(100_000, 0, 0)).toBe(0);
  });

  it("prefers percent-based formula over legacy flat when both are set", () => {
    // percent = 20% of $50k = $10k; flat = $7k — percent wins
    expect(calculateGOTVSpend(50_000, 20, 7_000)).toBe(10_000);
  });

  it("returns 0 when revenue is 0 regardless of percent", () => {
    expect(calculateGOTVSpend(0, 25, 0)).toBe(0);
  });
});

// ─── calculateSuppressionSpend ───────────────────────────────────────────────

describe("calculateSuppressionSpend", () => {
  it("returns correct floor of percentage spend", () => {
    // $200k revenue at 5% = $10k
    expect(calculateSuppressionSpend(200_000, 5)).toBe(10_000);
  });

  it("returns 0 when suppressionBudgetPercent is 0", () => {
    expect(calculateSuppressionSpend(100_000, 0)).toBe(0);
  });

  it("returns 0 when suppressionBudgetPercent is negative", () => {
    expect(calculateSuppressionSpend(100_000, -5)).toBe(0);
  });

  it("floors fractional result", () => {
    // $10k at 3% = $300 exactly
    expect(calculateSuppressionSpend(10_000, 3)).toBe(300);
    // $10_001 at 3% = 300.03 → Math.floor → 300
    expect(calculateSuppressionSpend(10_001, 3)).toBe(300);
  });
});

// ─── calculateOrgBuildingSpend ───────────────────────────────────────────────

describe("calculateOrgBuildingSpend", () => {
  it("returns correct floor of percentage spend", () => {
    expect(calculateOrgBuildingSpend(80_000, 15)).toBe(12_000);
  });

  it("returns 0 when percent is 0", () => {
    expect(calculateOrgBuildingSpend(100_000, 0)).toBe(0);
  });

  it("returns 0 when percent is negative", () => {
    expect(calculateOrgBuildingSpend(100_000, -1)).toBe(0);
  });
});

// ─── calculateNationalGOTVBoost ──────────────────────────────────────────────

describe("calculateNationalGOTVBoost", () => {
  it("returns 0 when numStates is 0 (no division-by-zero)", () => {
    expect(calculateNationalGOTVBoost(100_000, 0, 5_000, 1.0)).toBe(0);
  });

  it("divides spend evenly across states", () => {
    // $50k total / 10 states = $5k per state
    // $5k / $5k per point = 1.0 pp × 1.0 alignment = 1.0
    expect(calculateNationalGOTVBoost(50_000, 10, 5_000, 1.0)).toBe(1.0);
  });

  it("scales linearly with alignment multiplier", () => {
    // $10k / 1 state = $10k per point; $10k / $5k = 2.0 pp; × 0.5 alignment = 1.0
    expect(calculateNationalGOTVBoost(10_000, 1, 5_000, 0.5)).toBe(1.0);
  });

  it("produces fractional boosts for small spends", () => {
    // $1k / 5 states = $200 per state; $200 / $5000 = 0.04 pp × 1.0 alignment
    expect(calculateNationalGOTVBoost(1_000, 5, 5_000, 1.0)).toBeCloseTo(0.04, 4);
  });

  it("scales with dollar-per-point cost", () => {
    // $10k / 1 state; $10k / $10k per point = 1.0; × 1.0 alignment = 1.0
    expect(calculateNationalGOTVBoost(10_000, 1, 10_000, 1.0)).toBe(1.0);
    // Same spend but cheaper: $5k per point → 2.0 pp
    expect(calculateNationalGOTVBoost(10_000, 1, 5_000, 1.0)).toBe(2.0);
  });
});

// ─── calculateStateGOTVBoost ─────────────────────────────────────────────────

describe("calculateStateGOTVBoost", () => {
  it("calculates boost for state-scoped spend", () => {
    // $5k spend / $5k per point × 1.0 alignment = 1.0 pp
    expect(calculateStateGOTVBoost(5_000, 5_000, 1.0)).toBe(1.0);
  });

  it("scales with alignment multiplier", () => {
    // $5k / $5k per point × 0.5 = 0.5 pp
    expect(calculateStateGOTVBoost(5_000, 5_000, 0.5)).toBe(0.5);
  });

  it("returns 0 for zero spend", () => {
    expect(calculateStateGOTVBoost(0, 5_000, 1.0)).toBe(0);
  });
});

// ─── applyBoost ───────────────────────────────────────────────────────────────

describe("applyBoost", () => {
  it("applies positive boost to a demographic group", () => {
    const state = makeTurnoutState({ race: { white: 0 } });
    applyBoost(state, { category: "race", group: "white" }, 2.0);
    // Current = 0, boost = 2.0 → diminishing factor = 1.0 → newModifier = 2.0
    expect(state.modifiers.race!.white).toBe(2.0);
  });

  it("applies negative boost (suppression) to a demographic group", () => {
    const state = makeTurnoutState({ race: { black: 0 } });
    applyBoost(state, { category: "race", group: "black" }, -3.0);
    // Current = 0, boost = -3.0 → diminishing factor = 1.0 → newModifier = -3.0
    expect(state.modifiers.race!.black).toBe(-3.0);
  });

  it("clamps modifier at +20 maximum", () => {
    // Start near the cap: current = 19, boost = 5
    // diminishingFactor = 1 - 19/20 = 0.05; adjustedBoost = 5 * 0.05 = 0.25
    // newModifier = 19 + 0.25 = 19.25, clamped to 20? No: 19.25 < 20
    // Let's use a case that clearly clamps: current = 20, boost = 5
    // diminishingFactor = 1 - 20/20 = 0.0; adjustedBoost = 0; newModifier = 20
    const state = makeTurnoutState({ race: { white: 20 } });
    applyBoost(state, { category: "race", group: "white" }, 5.0);
    expect(state.modifiers.race!.white).toBe(20);
  });

  it("clamps modifier at -20 minimum", () => {
    // Start at cap: current = -20, boost = -5
    // diminishingFactor = 1 - 20/20 = 0.0; adjustedBoost = 0; newModifier = -20
    const state = makeTurnoutState({ race: { black: -20 } });
    applyBoost(state, { category: "race", group: "black" }, -5.0);
    expect(state.modifiers.race!.black).toBe(-20);
  });

  it("applies diminishing returns as modifier approaches cap", () => {
    // Current = 10, boost = 4
    // diminishingFactor = 1 - 10/20 = 0.5; adjustedBoost = 4 * 0.5 = 2
    // newModifier = 10 + 2 = 12
    const state = makeTurnoutState({ age: { young: 10 } });
    applyBoost(state, { category: "age", group: "young" }, 4.0);
    expect(state.modifiers.age!.young).toBe(12);
  });

  it("skips when category does not exist in state modifiers", () => {
    const state = makeTurnoutState({});
    // Should not throw; nothing to mutate
    applyBoost(state, { category: "nonexistent", group: "group1" }, 5.0);
    expect(state.modifiers).toEqual({});
  });

  it("treats missing group modifier as starting at 0", () => {
    const state = makeTurnoutState({ education: {} });
    applyBoost(state, { category: "education", group: "college" }, 3.0);
    // Current = 0 (missing), boost = 3.0 → diminishing factor = 1.0 → newModifier = 3.0
    expect(state.modifiers.education!.college).toBe(3.0);
  });
});

// ─── calculateMomentumGain ───────────────────────────────────────────────────

describe("calculateMomentumGain", () => {
  it("divides spend by dollarsPerMomentumPoint", () => {
    expect(calculateMomentumGain(10_000, 2_000)).toBe(5.0);
  });

  it("returns fractional gain for partial spend", () => {
    expect(calculateMomentumGain(1_000, 2_000)).toBe(0.5);
  });

  it("returns 0 for zero spend", () => {
    expect(calculateMomentumGain(0, 2_000)).toBe(0);
  });
});

// ─── calculateNewMomentum ────────────────────────────────────────────────────

describe("calculateNewMomentum", () => {
  it("sums current momentum and gain", () => {
    expect(calculateNewMomentum(3.0, 2.0)).toBe(5.0);
  });

  it("clamps positive result at +10", () => {
    expect(calculateNewMomentum(9.0, 5.0)).toBe(10.0);
  });

  it("clamps negative result at -10", () => {
    expect(calculateNewMomentum(-8.0, -5.0)).toBe(-10.0);
  });

  it("handles negative gain (org loss)", () => {
    expect(calculateNewMomentum(5.0, -3.0)).toBe(2.0);
  });

  it("stays at 0 for zero momentum and zero gain", () => {
    expect(calculateNewMomentum(0, 0)).toBe(0);
  });
});

// ─── applyMomentumDecay ──────────────────────────────────────────────────────

describe("applyMomentumDecay", () => {
  it("returns 0 immediately for zero momentum", () => {
    expect(applyMomentumDecay(0, 0.2)).toBe(0);
  });

  it("decays positive momentum toward 0", () => {
    // momentum = 5.0, decayRate = 0.2 → decayAmount = 1.0 → newMomentum = 4.0
    expect(applyMomentumDecay(5.0, 0.2)).toBe(4.0);
  });

  it("decays negative momentum toward 0", () => {
    // momentum = -5.0, decayRate = 0.2 → decayAmount = 1.0 → newMomentum = -4.0
    expect(applyMomentumDecay(-5.0, 0.2)).toBe(-4.0);
  });

  it("rounds result to one decimal place", () => {
    // momentum = 3.33, decayRate = 0.2 → decayAmount = 0.666 → newMomentum = 2.664 → 2.7
    expect(applyMomentumDecay(3.33, 0.2)).toBe(2.7);
  });

  it("snaps to 0 when result is below ZERO_THRESHOLD (0.1)", () => {
    // momentum = 0.05, decayRate = 0.2 → decayAmount = 0.01 → 0.04 < 0.1 → 0
    expect(applyMomentumDecay(0.05, 0.2)).toBe(0);
  });

  it("snaps negative values to 0 when magnitude is strictly below ZERO_THRESHOLD (0.1)", () => {
    // momentum = -0.08, decayRate = 0.2 → decayAmount = 0.016 → new = -0.064
    // rounded = -0.1; |-0.1| is NOT < 0.1 (it equals 0.1) → stays at -0.1
    expect(applyMomentumDecay(-0.08, 0.2)).toBe(-0.1);
  });

  it("snaps to 0 when rounded magnitude falls below threshold", () => {
    // momentum = -0.04, decayRate = 0.2 → decayAmount = 0.008 → new = -0.032
    // rounded = 0.0; |0.0| = 0 < 0.1 → snaps to 0
    expect(applyMomentumDecay(-0.04, 0.2)).toBe(0);
  });

  it("does not overshoot 0 for positive momentum", () => {
    // Very large decay rate applied to small momentum
    expect(applyMomentumDecay(0.5, 0.9)).toBeGreaterThanOrEqual(0);
  });
});

// ─── calculateCanvassingBoost ────────────────────────────────────────────────

describe("calculateCanvassingBoost", () => {
  it("gives full BASE_BOOST (0.05) for perfectly aligned canvasser out of campaign season", () => {
    // distance = 0 → alignmentMultiplier = 1.0; seasonMultiplier = 1.0
    const boost = calculateCanvassingBoost(
      { economic: 2, social: 1 },
      { economic: 2, social: 1 },
      false
    );
    expect(boost).toBeCloseTo(0.05, 4);
  });

  it("doubles boost during active campaign season", () => {
    // Same alignment, but campaign season
    const off = calculateCanvassingBoost(
      { economic: 0, social: 0 },
      { economic: 0, social: 0 },
      false
    );
    const on = calculateCanvassingBoost(
      { economic: 0, social: 0 },
      { economic: 0, social: 0 },
      true
    );
    expect(on).toBeCloseTo(off * 2, 4);
  });

  it("reduces boost for misaligned canvasser", () => {
    // distance = |3 - (-3)| + |3 - (-3)| = 6 + 6 = 12 (extreme misalignment)
    // alignmentMultiplier = max(0.1, 1 - 12 * 0.15) = max(0.1, -0.8) = 0.1
    const boost = calculateCanvassingBoost(
      { economic: 3, social: 3 },
      { economic: -3, social: -3 },
      false
    );
    expect(boost).toBeCloseTo(0.05 * 0.1, 4); // 0.005
  });

  it("clamps alignment multiplier at minimum 0.1 for extreme misalignment", () => {
    // distance = 5+5 = 10 → multiplier = 1 - 1.5 = -0.5 → clamped to 0.1
    const boost = calculateCanvassingBoost(
      { economic: 5, social: 5 },
      { economic: 0, social: 0 },
      false
    );
    expect(boost).toBeGreaterThanOrEqual(0.005); // 0.05 * 0.1
    expect(boost).toBeCloseTo(0.005, 4);
  });

  it("partial misalignment gives intermediate boost", () => {
    // distance = |2 - 0| + |2 - 0| = 4 → multiplier = 1 - 0.6 = 0.4
    const boost = calculateCanvassingBoost(
      { economic: 2, social: 2 },
      { economic: 0, social: 0 },
      false
    );
    expect(boost).toBeCloseTo(0.05 * 0.4, 4); // 0.02
  });
});

// ─── getDemographicLean ──────────────────────────────────────────────────────

describe("getDemographicLean", () => {
  it("returns correct lean for known demographic group", () => {
    // From LAYER1_DEMOGRAPHICS: white → economicLean: 1, socialLean: 1
    const lean = getDemographicLean("race", "white");
    expect(lean).toEqual({ economic: 1, social: 1 });
  });

  it("returns { economic: 0, social: 0 } for unknown category", () => {
    const lean = getDemographicLean("nonexistent_category", "some_group");
    expect(lean).toEqual({ economic: 0, social: 0 });
  });

  it("returns { economic: 0, social: 0 } for unknown group within known category", () => {
    const lean = getDemographicLean("race", "martian");
    expect(lean).toEqual({ economic: 0, social: 0 });
  });

  it("returns correct lean for ideologically aligned groups", () => {
    // progressives → economicLean: -5, socialLean: -5
    const lean = getDemographicLean("ideology", "progressives");
    expect(lean).toEqual({ economic: -5, social: -5 });
  });

  it("returns correct lean for senior age group", () => {
    // senior → economicLean: 2, socialLean: 3
    const lean = getDemographicLean("age", "senior");
    expect(lean).toEqual({ economic: 2, social: 3 });
  });
});
