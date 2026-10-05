import { describe, expect, it } from "vitest";
import {
  calibrateOpeningEconomicFactors,
  gameplayOpeningInflation,
  MAX_SUPPORTED_HISTORICAL_INFLATION,
  OPENING_INFLATION_KNEE,
  type OpeningInflationBounds,
} from "./openingInflation";

const bounds: OpeningInflationBounds = {
  minInflation: -2,
  maxInflation: 100,
  realWageClamp: [-5, 15],
  wageInflationPassthrough: 0.1,
};

describe("gameplayOpeningInflation", () => {
  it("leaves ordinary openings untouched", () => {
    for (const h of [-2, 0, 2.5, 9.3, 19.5, OPENING_INFLATION_KNEE]) {
      expect(gameplayOpeningInflation(h)).toBe(h);
    }
  });

  it("is monotone and continuous at the knee", () => {
    let last = -Infinity;
    for (let h = 0; h <= MAX_SUPPORTED_HISTORICAL_INFLATION; h += 0.5) {
      const g = gameplayOpeningInflation(h);
      expect(g).toBeGreaterThanOrEqual(last);
      last = g;
    }
    expect(gameplayOpeningInflation(OPENING_INFLATION_KNEE + 0.01)).toBeCloseTo(
      OPENING_INFLATION_KNEE + 0.01,
      2
    );
  });

  it("keeps the whole supported domain inside the runtime ceiling", () => {
    expect(gameplayOpeningInflation(MAX_SUPPORTED_HISTORICAL_INFLATION)).toBe(98.24);
    // A knee one point higher would push the domain maximum past 100.
    const k = OPENING_INFLATION_KNEE + 1;
    expect(k * (1 + Math.log(MAX_SUPPORTED_HISTORICAL_INFLATION / k))).toBeGreaterThan(100);
  });

  it("maps the 1991 historical openings", () => {
    expect(gameplayOpeningInflation(480)).toBe(83.56);
    expect(gameplayOpeningInflation(338.45)).toBe(76.57);
    expect(gameplayOpeningInflation(230.62)).toBe(68.9);
    expect(gameplayOpeningInflation(164)).toBe(62.08);
    expect(gameplayOpeningInflation(144)).toBe(59.48);
  });
});

describe("calibrateOpeningEconomicFactors", () => {
  it("returns ordinary openings by identity, wages included", () => {
    const f = { gdpGrowth: 1, wageGrowth: 14, inflationRate: 3.4 };
    expect(calibrateOpeningEconomicFactors(f, bounds)).toBe(f);
  });

  it("rebuilds wage growth with the runtime wage rule", () => {
    const br = calibrateOpeningEconomicFactors(
      { gdpGrowth: 1, wageGrowth: 50, inflationRate: 480, tradeGrowth: 2 },
      bounds
    );
    expect(br).toEqual({ gdpGrowth: 1, wageGrowth: 9.36, inflationRate: 83.56, tradeGrowth: 2 });
    // Real component is clamped exactly as wageGrowthNode clamps it.
    const ro = calibrateOpeningEconomicFactors(
      { gdpGrowth: -12.92, wageGrowth: 217.7, inflationRate: 230.62 },
      bounds
    );
    expect(ro.wageGrowth).toBe(1.89);
  });

  it("rejects inputs outside the supported domain", () => {
    const base = { gdpGrowth: 0, wageGrowth: 0 };
    expect(() => calibrateOpeningEconomicFactors({ ...base, inflationRate: 1001 }, bounds)).toThrow(
      /supported historical maximum/
    );
    expect(() => calibrateOpeningEconomicFactors({ ...base, inflationRate: -3 }, bounds)).toThrow(
      /runtime floor/
    );
    expect(() =>
      calibrateOpeningEconomicFactors({ ...base, inflationRate: Number.NaN }, bounds)
    ).toThrow(/non-finite/);
  });
});
