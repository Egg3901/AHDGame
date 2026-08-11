import { describe, expect, it } from "vitest";
import {
  applyPoliticalInfluenceDecay,
  calculateFavorabilityAboveThresholdPenalty,
  calculateInfamyFavorabilityDrain,
  calculateNationalInfluenceGain,
  calculatePoliticalInfluenceDecay,
  FAVORABILITY_NATURAL_DECAY_THRESHOLD,
  FEDERAL_MULTIPLIER,
  getFederalMultiplier,
  nationalDecayScope,
  NATIONAL_LAW_DECAY_MULTIPLIER,
  NPP_POLITICAL_INFLUENCE_FLOOR,
  POLITICAL_INFLUENCE_DECAY_RATE,
  UK_FEDERAL_MULTIPLIER,
} from "./formulas";

describe("calculateFavorabilityAboveThresholdPenalty", () => {
  it("returns 0 at or below equilibrium threshold", () => {
    expect(calculateFavorabilityAboveThresholdPenalty(60)).toBe(0);
    expect(calculateFavorabilityAboveThresholdPenalty(50)).toBe(0);
  });

  it("decays only above the 60% floor", () => {
    expect(calculateFavorabilityAboveThresholdPenalty(70)).toBeCloseTo(0.5, 5);
    expect(calculateFavorabilityAboveThresholdPenalty(80)).toBeCloseTo(1.0, 5);
    expect(calculateFavorabilityAboveThresholdPenalty(100)).toBeCloseTo(2.0, 5);
  });

  it("caps overflowed favorability at the 100% penalty", () => {
    expect(calculateFavorabilityAboveThresholdPenalty(140)).toBeCloseTo(2.0, 5);
  });

  it("exports threshold matching formula", () => {
    expect(FAVORABILITY_NATURAL_DECAY_THRESHOLD).toBe(60);
  });
});

describe("calculateInfamyFavorabilityDrain", () => {
  it("returns 0 at or below the 20-infamy threshold", () => {
    expect(calculateInfamyFavorabilityDrain(0)).toBe(0);
    expect(calculateInfamyFavorabilityDrain(20)).toBe(0);
  });

  it("matches the advertised (infamy - 20) x 0.05 per turn above 20", () => {
    // The exact formula shown on profile / character pages and the stats wiki.
    expect(calculateInfamyFavorabilityDrain(40)).toBeCloseTo(1.0, 5);
    expect(calculateInfamyFavorabilityDrain(60)).toBeCloseTo(2.0, 5);
    expect(calculateInfamyFavorabilityDrain(100)).toBeCloseTo(4.0, 5);
  });

  it("clamps out-of-range infamy to the 0..100 scale", () => {
    expect(calculateInfamyFavorabilityDrain(-5)).toBe(0);
    expect(calculateInfamyFavorabilityDrain(140)).toBeCloseTo(4.0, 5);
  });
});

describe("political influence helpers", () => {
  it("exports the updated lower decay slope", () => {
    expect(POLITICAL_INFLUENCE_DECAY_RATE).toBe(0.0075);
  });

  it("calculates political influence decay at the new rate", () => {
    expect(calculatePoliticalInfluenceDecay(100)).toBeCloseTo(0.75, 5);
    expect(calculatePoliticalInfluenceDecay(40)).toBeCloseTo(0.3, 5);
  });

  it("caps overflowed political influence for decay and NPI gain", () => {
    expect(calculatePoliticalInfluenceDecay(140)).toBeCloseTo(0.75, 5);
    expect(calculateNationalInfluenceGain(140)).toBeCloseTo(1.0, 5);
  });

  it("keeps national influence gain on the existing divisor", () => {
    expect(calculateNationalInfluenceGain(100)).toBeCloseTo(1.0, 5);
    expect(calculateNationalInfluenceGain(40)).toBeCloseTo(0.4, 5);
  });
});

describe("applyPoliticalInfluenceDecay", () => {
  it("decays toward a 0 floor by default (player behavior, unchanged)", () => {
    // 10 - 10*0.0075 = 9.925, no floor applied
    expect(applyPoliticalInfluenceDecay(10)).toBeCloseTo(9.925, 5);
    // a low player value keeps decaying toward 0
    expect(applyPoliticalInfluenceDecay(2)).toBeCloseTo(2 - 2 * 0.0075, 5);
  });

  it("exports the NPP floor at the seed value", () => {
    expect(NPP_POLITICAL_INFLUENCE_FLOOR).toBe(10);
  });

  it("never decays an NPP below the floor", () => {
    // sitting exactly on the floor stays on the floor (does not slip to 9.925)
    expect(
      applyPoliticalInfluenceDecay(NPP_POLITICAL_INFLUENCE_FLOOR, NPP_POLITICAL_INFLUENCE_FLOOR)
    ).toBe(10);
    // a value above the floor still decays normally
    expect(applyPoliticalInfluenceDecay(30, NPP_POLITICAL_INFLUENCE_FLOOR)).toBeCloseTo(
      30 - 30 * 0.0075,
      5
    );
  });

  it("holds a below-floor value in place rather than inflating it up", () => {
    // Deliberately low-profile NPPs (e.g. shell CEOs seeded at 1) are held, not
    // bumped to 10 — the floor is a barrier, not a target.
    expect(applyPoliticalInfluenceDecay(5, NPP_POLITICAL_INFLUENCE_FLOOR)).toBe(5);
    expect(applyPoliticalInfluenceDecay(1, NPP_POLITICAL_INFLUENCE_FLOOR)).toBe(1);
  });

  it("caps overflowed influence at 100 regardless of floor", () => {
    expect(applyPoliticalInfluenceDecay(140, NPP_POLITICAL_INFLUENCE_FLOOR)).toBe(100);
  });
});

describe("federal multiplier constants (tick path — per country)", () => {
  it("FEDERAL_MULTIPLIER equals 1/50", () => {
    expect(FEDERAL_MULTIPLIER).toBe(1 / 50);
  });

  it("UK_FEDERAL_MULTIPLIER equals 1/12", () => {
    expect(UK_FEDERAL_MULTIPLIER).toBe(1 / 12);
  });
});

describe("getFederalMultiplier — per-country tick scope", () => {
  it("returns 1/50 for US", () => {
    expect(getFederalMultiplier("US")).toBe(1 / 50);
  });

  it("returns 1/12 for UK", () => {
    expect(getFederalMultiplier("UK")).toBe(1 / 12);
  });

  it("returns 1/50 for CA (default)", () => {
    expect(getFederalMultiplier("CA")).toBe(1 / 50);
  });
});

describe("nationalDecayScope — normalized national decay (#0962 balance pass)", () => {
  it("NATIONAL_LAW_DECAY_MULTIPLIER is the calibrated ~4.5%/decade value", () => {
    expect(NATIONAL_LAW_DECAY_MULTIPLIER).toBe(0.21);
  });

  it("normalizes any diluted national scope (< 1) to the uniform decay multiplier", () => {
    expect(nationalDecayScope(1 / 50)).toBe(NATIONAL_LAW_DECAY_MULTIPLIER); // US
    expect(nationalDecayScope(1 / 12)).toBe(NATIONAL_LAW_DECAY_MULTIPLIER); // UK
    expect(nationalDecayScope(1 / 8)).toBe(NATIONAL_LAW_DECAY_MULTIPLIER); // JP
  });

  it("leaves state/regional laws (scope 1) at full strength", () => {
    expect(nationalDecayScope(1)).toBe(1);
  });
});
