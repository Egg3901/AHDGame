import { describe, expect, it } from "vitest";
import {
  advanceClimateExposure,
  climateLossMultiplier,
  effectiveEmissions,
  populationWeightedEmissions,
  weatherDisasterCadence,
  WEATHER_DISASTER_KEYS,
} from "./climateFeedback";

describe("bounded climate feedback", () => {
  it("weights emissions by actual residents and excludes missing observations", () => {
    expect(
      populationWeightedEmissions([
        { population: 10, tonsPerCapita: 2 },
        { population: 30, tonsPerCapita: 10 },
        { population: 5, tonsPerCapita: Number.NaN },
      ])
    ).toBe(8);
    expect(populationWeightedEmissions([{ population: 5, tonsPerCapita: Number.NaN }])).toBeNull();
  });

  it("turns enacted environment spending and funded programmes into lower emissions", () => {
    expect(effectiveEmissions(12, 0)).toBe(12);
    expect(effectiveEmissions(12, 200)).toBe(11);
    expect(effectiveEmissions(12, 200, -1.5)).toBe(9.5);
    expect(effectiveEmissions(0.5, 1_000_000, -1.5)).toBe(0);
  });

  it("accumulates excess emissions gradually, recovers slowly, and remains bounded", () => {
    expect(advanceClimateExposure(0, 8, 1).pressure).toBeCloseTo(0.024);
    expect(advanceClimateExposure(0.2, 3, 2).pressure).toBeCloseTo(0.196);
    expect(advanceClimateExposure(0.99, 60, 100).pressure).toBe(1);
    expect(advanceClimateExposure(0.001, 0, 5).pressure).toBe(0);
  });

  it("increases only weather opening and limits loss with adaptation", () => {
    expect(weatherDisasterCadence(144, 0)).toBe(144);
    expect(weatherDisasterCadence(144, 1)).toBeGreaterThanOrEqual(108);
    expect(weatherDisasterCadence(144, 1)).toBeLessThan(144);
    expect(climateLossMultiplier(1, 0)).toBe(1.5);
    expect(climateLossMultiplier(1, 100)).toBe(1);
    expect(WEATHER_DISASTER_KEYS.has("flood")).toBe(true);
    expect(WEATHER_DISASTER_KEYS.has("earthquake")).toBe(false);
    expect(WEATHER_DISASTER_KEYS.has("industrial_accident")).toBe(false);
  });
});
