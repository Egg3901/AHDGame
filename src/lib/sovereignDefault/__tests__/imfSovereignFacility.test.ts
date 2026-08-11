import { describe, it, expect } from "vitest";
import { computeSovereignBailoutTerms } from "../imfSovereignFacility";
import {
  IMF_SOVEREIGN_DEFAULT_RATE,
  IMF_SOVEREIGN_AMORTIZATION_TURNS,
  IMF_SOVEREIGN_INCOME_CAPTURE_DEFAULT,
  IMF_SOVEREIGN_INCOME_CAPTURE_MIN,
  IMF_SOVEREIGN_INCOME_CAPTURE_CAP,
} from "../constants";

describe("computeSovereignBailoutTerms", () => {
  it("principal = rollover + deficit", () => {
    const terms = computeSovereignBailoutTerms({
      rolloverFaceValue: 1_500_000_000_000,
      annualDeficit: 500_000_000_000,
    });
    expect(terms.principal).toBe(2_000_000_000_000);
  });

  it("uses default rate, amortization, and capture from constants", () => {
    const terms = computeSovereignBailoutTerms({
      rolloverFaceValue: 1_000_000_000,
      annualDeficit: 0,
    });
    expect(terms.annualRatePercent).toBe(IMF_SOVEREIGN_DEFAULT_RATE * 100);
    expect(terms.amortizationTurns).toBe(IMF_SOVEREIGN_AMORTIZATION_TURNS);
    expect(terms.incomeCaptureFraction).toBe(IMF_SOVEREIGN_INCOME_CAPTURE_DEFAULT);
  });

  it("treats negative annualDeficit (surplus country) as zero", () => {
    const terms = computeSovereignBailoutTerms({
      rolloverFaceValue: 1_000_000_000,
      annualDeficit: -500_000_000,
    });
    expect(terms.principal).toBe(1_000_000_000);
  });

  it("treats negative rollover as zero (defensive)", () => {
    const terms = computeSovereignBailoutTerms({
      rolloverFaceValue: -1,
      annualDeficit: 10,
    });
    expect(terms.principal).toBe(10);
  });

  it("clamps capture fraction to [MIN, CAP]", () => {
    const terms = computeSovereignBailoutTerms({
      rolloverFaceValue: 1_000_000_000,
      annualDeficit: 0,
    });
    expect(terms.incomeCaptureFraction).toBeGreaterThanOrEqual(IMF_SOVEREIGN_INCOME_CAPTURE_MIN);
    expect(terms.incomeCaptureFraction).toBeLessThanOrEqual(IMF_SOVEREIGN_INCOME_CAPTURE_CAP);
  });
});
