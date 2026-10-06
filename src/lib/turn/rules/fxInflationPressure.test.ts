import { describe, expect, it } from "vitest";
import { calculateFxInflationPressure, FX_INFLATION_LOOKBACK_TURNS } from "./fxInflationPressure";

describe("calculateFxInflationPressure", () => {
  it("annualizes and bounds a depreciation across the lookback window", () => {
    expect(
      calculateFxInflationPressure(
        [
          { turn: 87, rate: 1 },
          { turn: 99, rate: 1.25 },
        ],
        100
      )
    ).toBe(0.25);
  });

  it("clears the pass-through after the comparison window is at the new FX level", () => {
    expect(
      calculateFxInflationPressure(
        [
          { turn: 99, rate: 1.25 },
          { turn: 99 + FX_INFLATION_LOOKBACK_TURNS, rate: 1.25 },
        ],
        100 + FX_INFLATION_LOOKBACK_TURNS
      )
    ).toBe(0);
  });

  it("does not infer depreciation from the initial rate or missing snapshots", () => {
    expect(calculateFxInflationPressure([], 100)).toBe(0);
    expect(calculateFxInflationPressure([{ turn: 99, rate: 1.25 }], 100)).toBe(0);
  });

  it("annualizes sparse observations using their actual elapsed turns", () => {
    expect(
      calculateFxInflationPressure(
        [
          { turn: 70, rate: 1 },
          { turn: 90, rate: 1.05 },
        ],
        91
      )
    ).toBeCloseTo(Math.pow(1.05, 48 / 20) - 1, 10);
  });

  it("uses negative pressure for appreciation and ignores invalid samples", () => {
    expect(
      calculateFxInflationPressure(
        [
          { turn: 87, rate: 1.25 },
          { turn: 90, rate: Number.NaN },
          { turn: 99, rate: 1 },
        ],
        100
      )
    ).toBe(-0.25);
  });
});
