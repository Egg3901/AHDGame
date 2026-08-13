import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_BAND_AMBER_MIN,
  CONFIDENCE_BAND_GREEN_MIN,
  CONFIDENCE_FORCED_LIQUIDATION_PENALTY,
  computeConfidence,
  type ConfidenceInput,
} from "../confidence";

function baseInput(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    cashReserves: 100_000,
    postedCapital: 100_000,
    totalDeposits: 1_000_000,
    totalLoans: 200_000,
    reserveRatioRequired: 0.1,
    arrearsOutstanding: 0,
    defaultsLastTurn: 0,
    panicTurns: 0,
    ...overrides,
  };
}

describe("computeConfidence", () => {
  it("is monotonic in reserves and capital (more => higher)", () => {
    const thin = computeConfidence(baseInput({ cashReserves: 20_000, postedCapital: 20_000 }));
    const mid = computeConfidence(baseInput({ cashReserves: 80_000, postedCapital: 80_000 }));
    const thick = computeConfidence(baseInput({ cashReserves: 200_000, postedCapital: 200_000 }));
    expect(mid.confidence).toBeGreaterThan(thin.confidence);
    expect(thick.confidence).toBeGreaterThan(mid.confidence);
  });

  it("is monotonic in arrears, defaults, and panic (more => lower)", () => {
    const clean = computeConfidence(baseInput());
    const arrears = computeConfidence(baseInput({ arrearsOutstanding: 80_000 }));
    const defaults = computeConfidence(baseInput({ defaultsLastTurn: 80_000 }));
    const panic = computeConfidence(baseInput({ panicTurns: 3 }));
    expect(arrears.confidence).toBeLessThan(clean.confidence);
    expect(defaults.confidence).toBeLessThan(clean.confidence);
    expect(panic.confidence).toBeLessThan(clean.confidence);
  });

  it("applies a flat penalty when forcedLiquidation is set", () => {
    const clean = computeConfidence(baseInput());
    const forced = computeConfidence(baseInput({ forcedLiquidation: true }));
    expect(clean.confidence - forced.confidence).toBeCloseTo(
      CONFIDENCE_FORCED_LIQUIDATION_PENALTY,
      5
    );
  });

  it("maps bands at the provisional thresholds", () => {
    // Tuned inputs: green / amber / red around the exported cutoffs.
    const green = computeConfidence(
      baseInput({ cashReserves: 200_000, postedCapital: 200_000, totalLoans: 100_000 })
    );
    expect(green.confidence).toBeGreaterThanOrEqual(CONFIDENCE_BAND_GREEN_MIN);
    expect(green.band).toBe("green");

    const amber = computeConfidence(
      baseInput({
        cashReserves: 40_000,
        postedCapital: 50_000,
        totalDeposits: 1_000_000,
        totalLoans: 300_000,
        reserveRatioRequired: 0.1,
      })
    );
    expect(amber.confidence).toBeGreaterThanOrEqual(CONFIDENCE_BAND_AMBER_MIN);
    expect(amber.confidence).toBeLessThan(CONFIDENCE_BAND_GREEN_MIN);
    expect(amber.band).toBe("amber");

    const red = computeConfidence(
      baseInput({
        cashReserves: 5_000,
        postedCapital: 5_000,
        totalDeposits: 1_000_000,
        totalLoans: 500_000,
        reserveRatioRequired: 0.2,
        arrearsOutstanding: 200_000,
      })
    );
    expect(red.confidence).toBeLessThan(CONFIDENCE_BAND_AMBER_MIN);
    expect(red.band).toBe("red");
  });

  it("clamps confidence to [0, 1]", () => {
    const high = computeConfidence(
      baseInput({ cashReserves: 10_000_000, postedCapital: 10_000_000, totalLoans: 1 })
    );
    expect(high.confidence).toBeLessThanOrEqual(1);
    const low = computeConfidence(
      baseInput({
        cashReserves: 0,
        postedCapital: 0,
        totalLoans: 1_000_000,
        arrearsOutstanding: 1_000_000,
        defaultsLastTurn: 1_000_000,
        panicTurns: 99,
      })
    );
    expect(low.confidence).toBeGreaterThanOrEqual(0);
  });
});
