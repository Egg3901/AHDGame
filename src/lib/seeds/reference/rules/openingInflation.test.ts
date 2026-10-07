import { describe, expect, it } from "vitest";
import {
  calibrateOpeningEconomicFactors,
  GAMEPLAY_OPENING_INFLATION_1991,
  GAMEPLAY_OPENING_INFLATION_MAX,
  GAMEPLAY_OPENING_INFLATION_MIN,
  openingInflationProblem,
  runtimeOpeningWageGrowth,
  type OpeningInflationBounds,
} from "./openingInflation";

const bounds: OpeningInflationBounds = {
  minInflation: -2,
  realWageClamp: [-5, 15],
  wageInflationPassthrough: 0.1,
};

describe("gameplay opening inflation table", () => {
  it("places every calibrated opening in the moderate band, below its history", () => {
    for (const [country, row] of Object.entries(GAMEPLAY_OPENING_INFLATION_1991)) {
      expect(row.gameplay, country).toBeGreaterThanOrEqual(GAMEPLAY_OPENING_INFLATION_MIN);
      expect(row.gameplay, country).toBeLessThanOrEqual(GAMEPLAY_OPENING_INFLATION_MAX);
      expect(row.historical, country).toBeGreaterThan(GAMEPLAY_OPENING_INFLATION_MAX);
    }
  });

  it("keeps historical severity order within the unanchored group", () => {
    const unanchored = Object.values(GAMEPLAY_OPENING_INFLATION_1991)
      .filter((row) => row.basis === "unanchored-severity")
      .sort((a, b) => b.historical - a.historical);
    for (let i = 1; i < unanchored.length; i++) {
      expect(unanchored[i]!.gameplay).toBeLessThanOrEqual(unanchored[i - 1]!.gameplay);
    }
  });
});

describe("calibrateOpeningEconomicFactors", () => {
  it("returns ordinary openings unchanged, wages included", () => {
    const f = { gdpGrowth: 1.5, wageGrowth: 15, inflationRate: 20 };
    expect(calibrateOpeningEconomicFactors("NG", f, bounds)).toBe(f);
  });

  it("opens Brazil at its 12% era target with runtime-rule wages", () => {
    expect(
      calibrateOpeningEconomicFactors(
        "BR",
        { gdpGrowth: 1, wageGrowth: 50, inflationRate: 480, tradeGrowth: 2 },
        bounds
      )
    ).toEqual({ gdpGrowth: 1, wageGrowth: 2.2, inflationRate: 12, tradeGrowth: 2 });
  });

  it("clamps the real wage component as the runtime does", () => {
    const bg = calibrateOpeningEconomicFactors(
      "BG",
      { gdpGrowth: -8.45, wageGrowth: 330, inflationRate: 338.45 },
      bounds
    );
    expect(bg).toEqual({ gdpGrowth: -8.45, wageGrowth: -3, inflationRate: 20 });
    expect(runtimeOpeningWageGrowth(30, 10, bounds)).toBe(16);
  });

  it("rejects a high opening without a row, or with drifted history", () => {
    const f = { gdpGrowth: 0, wageGrowth: 0, inflationRate: 40 };
    expect(() => calibrateOpeningEconomicFactors("US", f, bounds)).toThrow(/no gameplay/);
    expect(() =>
      calibrateOpeningEconomicFactors("BR", { ...f, inflationRate: 470 }, bounds)
    ).toThrow(/does not match/);
    expect(() =>
      calibrateOpeningEconomicFactors("US", { ...f, inflationRate: Number.NaN }, bounds)
    ).toThrow(/non-finite/);
  });
});

describe("openingInflationProblem", () => {
  it("accepts calibrated and ordinary openings", () => {
    expect(
      openingInflationProblem("BR", { gdpGrowth: 1, wageGrowth: 2.2, inflationRate: 12 }, bounds)
    ).toBeNull();
    expect(
      openingInflationProblem(
        "US",
        { gdpGrowth: -0.1, wageGrowth: 3.5, inflationRate: 4.2 },
        bounds
      )
    ).toBeNull();
  });

  it("flags historical, snapped or incoherent openings", () => {
    const br = { gdpGrowth: 1, wageGrowth: 50, inflationRate: 480 };
    expect(openingInflationProblem("BR", br, bounds)).toMatch(/outside/);
    expect(openingInflationProblem("BR", { ...br, inflationRate: 100 }, bounds)).toMatch(/outside/);
    expect(openingInflationProblem("BR", { ...br, inflationRate: 12 }, bounds)).toMatch(/wage/);
    expect(openingInflationProblem("BR", { ...br, inflationRate: 15 }, bounds)).toMatch(
      /gameplay value/
    );
    expect(openingInflationProblem("US", { ...br, inflationRate: -3 }, bounds)).toMatch(/outside/);
  });
});
