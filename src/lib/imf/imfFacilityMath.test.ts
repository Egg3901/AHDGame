import { describe, it, expect } from "vitest";
import {
  computeImfFacilityPaymentTurn,
  imfLevelPaymentPerTurn,
  imfPerTurnInterestRate,
  simulateImfFacilityPayoffTurns,
} from "./imfFacilityMath";

describe("imfFacilityMath", () => {
  it("computes payment with cap and capitalization when income is zero", () => {
    const split = computeImfFacilityPaymentTurn({
      principalOutstanding: 1_000_000,
      annualRatePercent: 12,
      remainingTurns: 48,
      turnIncome: 0,
      incomeCapFraction: 0.45,
    });
    expect(split.actualPayment).toBe(0);
    expect(split.newPrincipal).toBeGreaterThan(1_000_000);
  });

  it("reduces principal when payment covers interest and some principal", () => {
    const split = computeImfFacilityPaymentTurn({
      principalOutstanding: 500_000,
      annualRatePercent: 6,
      remainingTurns: 96,
      turnIncome: 1_000_000,
      incomeCapFraction: 0.45,
    });
    expect(split.actualPayment).toBeGreaterThan(0);
    expect(split.newPrincipal).toBeLessThan(500_000);
  });

  it("imfLevelPaymentPerTurn is positive for typical inputs", () => {
    const r = imfPerTurnInterestRate(6);
    const pmt = imfLevelPaymentPerTurn(1_000_000, r, 240);
    expect(pmt).toBeGreaterThan(0);
  });

  it("simulateImfFacilityPayoffTurns clears when income comfortably covers schedule", () => {
    const sim = simulateImfFacilityPayoffTurns({
      initialPrincipal: 100_000,
      annualRatePercent: 6,
      amortizationTurns: 96,
      turnIncome: 500_000,
      incomeCapFraction: 0.35,
    });
    expect(sim.outcome).toBe("cleared");
    expect(sim.estimatedTurns).toBeGreaterThan(0);
    expect(sim.warning).toBeNull();
  });

  it("simulateImfFacilityPayoffTurns warns when cap cannot cover interest", () => {
    const sim = simulateImfFacilityPayoffTurns({
      initialPrincipal: 5_000_000,
      annualRatePercent: 24,
      amortizationTurns: 48,
      turnIncome: 10_000,
      incomeCapFraction: 0.1,
    });
    expect(sim.outcome).toBe("principal_rising");
    expect(sim.warning).toBeTruthy();
  });
});
