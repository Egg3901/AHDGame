import { describe, it, expect } from "vitest";
import { deriveGroupTurnout, type Layer1Config } from "./stateDemographics";

describe("deriveGroupTurnout", () => {
  const testStateConfig: Layer1Config = {
    race: { white: 60, black: 12, hispanic: 18, asian: 8, other: 2 },
    age: { young: 24, mid: 24, mature: 26, senior: 26 },
    education: { no_college: 60, college: 26, graduate: 14 },
    wealth: { low: 35, middle: 50, high: 15 },
    ideology: {
      evangelicals: 20,
      environmentalists: 15,
      libertarians: 10,
      progressives: 18,
      patriots: 22,
      gunowners: 15,
    },
  };

  it("uses baseline turnout when no state-specific turnout provided", () => {
    const turnout = deriveGroupTurnout("young_renters", testStateConfig, 38, "2019");

    // Should calculate from baseline DEMOGRAPHIC_TURNOUT_RATES
    expect(turnout).toBeGreaterThan(0);
    expect(turnout).toBeLessThan(100);
  });

  it("uses state-specific turnout when provided", () => {
    const stateSpecificTurnout = {
      race: { white: 65, black: 60, hispanic: 50, asian: 55, other: 50 },
      age: { young: 50, mid: 60, mature: 65, senior: 75 },
      education: { no_college: 55, college: 68, graduate: 75 },
      wealth: { low: 50, middle: 60, high: 68 },
      ideology: {
        evangelicals: 72,
        environmentalists: 68,
        libertarians: 68,
        progressives: 68,
        patriots: 70,
        gunowners: 68,
      },
    };

    const baselineTurnout = deriveGroupTurnout("young_renters", testStateConfig, 38, "2019");
    const customTurnout = deriveGroupTurnout(
      "young_renters",
      testStateConfig,
      38,
      "2019",
      stateSpecificTurnout
    );

    // Should be different from baseline since we're using higher turnout rates
    expect(customTurnout).not.toBe(baselineTurnout);
    // Young renters are weighted towards young age and low wealth, both higher in state-specific
    expect(customTurnout).toBeGreaterThan(baselineTurnout);
  });

  it("falls back to baseline for missing demographics in state-specific turnout", () => {
    const partialStateSpecificTurnout = {
      race: { white: 65, black: 60, hispanic: 50, asian: 55, other: 50 },
      age: { young: 50, mid: 60, mature: 65, senior: 75 },
      education: { no_college: 55, college: 68, graduate: 75 },
      wealth: {}, // Empty wealth - should fall back to baseline
      ideology: {
        evangelicals: 72,
        environmentalists: 68,
        libertarians: 68,
        progressives: 68,
        patriots: 70,
        gunowners: 68,
      },
    };

    const turnout = deriveGroupTurnout(
      "young_renters",
      testStateConfig,
      38,
      "2019",
      partialStateSpecificTurnout
    );

    // Should still work and produce a valid turnout
    expect(turnout).toBeGreaterThan(0);
    expect(turnout).toBeLessThan(100);
  });

  it("supports non-2019 era parameter", () => {
    const config: Layer1Config = {
      race: { white: 60, black: 30, hispanic: 5, asian: 4, other: 1 },
      education: { no_college: 50, college: 30, graduate: 20 },
      wealth: { low: 30, middle: 50, high: 20 },
      age: { young: 25, mid: 25, mature: 25, senior: 25 },
      ideology: {
        evangelicals: 10,
        environmentalists: 10,
        libertarians: 10,
        progressives: 10,
        patriots: 10,
        gunowners: 10,
      },
    };
    const result2019 = deriveGroupTurnout("young_renters", config, 55, "2019");
    const result1991 = deriveGroupTurnout("young_renters", config, 55, "1991");
    // Era-specific turnout rates now produce distinct results per era.
    expect(result1991).not.toBe(result2019);
    expect(result1991).toBeGreaterThan(0);
    expect(result1991).toBeLessThan(100);
  });
});
