import { describe, it, expect } from "vitest";
import {
  RECOVERY_FLOOR_TURNS,
  DEFAULT_MARGIN_FULL_PENALTY_TURNS,
  DEFAULT_MARGIN_DECAY_TURNS,
  DEFAULT_MARGIN_PENALTY_REPUDIATE,
  DEFAULT_MARGIN_PENALTY_RESTRUCTURE,
  DEFAULT_MARGIN_PENALTY_BAILOUT,
  DEFAULT_MARGIN_PENALTY_MONETIZE,
  DEFAULT_MARGIN_SECTOR_MULTIPLIERS,
  EXECUTIVE_DECISION_HOURS,
  LEGISLATIVE_VOTE_HOURS_PER_CHAMBER,
  FAILED_AUCTION_COUNT_FOR_CRISIS,
  DEMAND_FULL_THRESHOLD,
  DEMAND_UNDERSUBSCRIBED_THRESHOLD,
  MONETIZE_GATE_INFLATION,
  IMF_SOVEREIGN_INCOME_CAPTURE_MIN,
  IMF_SOVEREIGN_INCOME_CAPTURE_DEFAULT,
  IMF_SOVEREIGN_INCOME_CAPTURE_CAP,
  CASCADE_MAX_LEVELS,
  MASS_CASCADE_THRESHOLD,
  ENTITY_DEMAND_WEIGHT,
  ENTITY_DEMAND_CAP,
  GLOBAL_CONTAGION_MULTIPLIER,
} from "../constants";

describe("sovereignDefault constants", () => {
  it("recovery floor is 48 turns matching design", () => {
    expect(RECOVERY_FLOOR_TURNS).toBe(48);
  });

  it("margin penalty window is 48 full + 24 decay = 72 total", () => {
    expect(DEFAULT_MARGIN_FULL_PENALTY_TURNS).toBe(48);
    expect(DEFAULT_MARGIN_DECAY_TURNS).toBe(24);
  });

  it("margin penalties are post-1.5x bumped values", () => {
    expect(DEFAULT_MARGIN_PENALTY_REPUDIATE).toBeCloseTo(-0.18);
    expect(DEFAULT_MARGIN_PENALTY_RESTRUCTURE).toBeCloseTo(-0.09);
    expect(DEFAULT_MARGIN_PENALTY_BAILOUT).toBeCloseTo(-0.045);
    expect(DEFAULT_MARGIN_PENALTY_MONETIZE).toBe(0);
  });

  it("sector multipliers cover all 17 corporation types in 4 tiers", () => {
    const tier1 = ["financial"] as const;
    const tier2 = [
      "manufacturing",
      "retail",
      "automobiles",
      "chemical_industries",
      "real_estate",
      "construction",
    ] as const;
    const tier3 = [
      "technology",
      "telecommunications",
      "healthcare",
      "media",
      "entertainment",
      "logistics",
      "defense",
    ] as const;
    const tier4 = ["energy", "extraction", "agriculture"] as const;

    for (const t of tier1) expect(DEFAULT_MARGIN_SECTOR_MULTIPLIERS[t]).toBe(1.5);
    for (const t of tier2) expect(DEFAULT_MARGIN_SECTOR_MULTIPLIERS[t]).toBe(1.3);
    for (const t of tier3) expect(DEFAULT_MARGIN_SECTOR_MULTIPLIERS[t]).toBe(1.0);
    for (const t of tier4) expect(DEFAULT_MARGIN_SECTOR_MULTIPLIERS[t]).toBe(0.7);
    expect(Object.keys(DEFAULT_MARGIN_SECTOR_MULTIPLIERS)).toHaveLength(17);
  });

  it("crisis windows match design (12h exec, 24h per chamber)", () => {
    expect(EXECUTIVE_DECISION_HOURS).toBe(12);
    expect(LEGISLATIVE_VOTE_HOURS_PER_CHAMBER).toBe(24);
  });

  it("failed-auction trigger fires at 3 consecutive failed", () => {
    expect(FAILED_AUCTION_COUNT_FOR_CRISIS).toBe(3);
  });

  it("demand thresholds: 1.0 full, 0.7 undersubscribed cliff", () => {
    expect(DEMAND_FULL_THRESHOLD).toBe(1.0);
    expect(DEMAND_UNDERSUBSCRIBED_THRESHOLD).toBe(0.7);
  });

  it("monetize gate is 8% inflation", () => {
    expect(MONETIZE_GATE_INFLATION).toBeCloseTo(0.08);
  });

  it("IMF income capture range is 10-30% with 20% default", () => {
    expect(IMF_SOVEREIGN_INCOME_CAPTURE_MIN).toBeCloseTo(0.1);
    expect(IMF_SOVEREIGN_INCOME_CAPTURE_DEFAULT).toBeCloseTo(0.2);
    expect(IMF_SOVEREIGN_INCOME_CAPTURE_CAP).toBeCloseTo(0.3);
    expect(IMF_SOVEREIGN_INCOME_CAPTURE_MIN).toBeLessThanOrEqual(
      IMF_SOVEREIGN_INCOME_CAPTURE_DEFAULT
    );
    expect(IMF_SOVEREIGN_INCOME_CAPTURE_DEFAULT).toBeLessThanOrEqual(
      IMF_SOVEREIGN_INCOME_CAPTURE_CAP
    );
  });

  it("cascade is bounded at 3 levels max", () => {
    expect(CASCADE_MAX_LEVELS).toBe(3);
  });

  it("mass cascade threshold is 5 corps", () => {
    expect(MASS_CASCADE_THRESHOLD).toBe(5);
  });

  it("entity demand contribution is weighted 0.5 with 0.4 cap", () => {
    expect(ENTITY_DEMAND_WEIGHT).toBeCloseTo(0.5);
    expect(ENTITY_DEMAND_CAP).toBeCloseTo(0.4);
  });

  it("global contagion multiplier is the documented 0.5 default (phase 7)", () => {
    expect(GLOBAL_CONTAGION_MULTIPLIER).toBe(0.5);
  });
});
