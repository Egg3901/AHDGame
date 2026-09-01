import { describe, it, expect } from "vitest";
import { formatCrisisEffectValue } from "./effectLabels";

describe("formatCrisisEffectValue", () => {
  it("trims the binary-rounding tail the live recession stores", () => {
    expect(formatCrisisEffectValue(-0.6599999999999999)).toBe("-0.66");
    expect(formatCrisisEffectValue(0.44999999999999996)).toBe("0.45");
    expect(formatCrisisEffectValue(-0.8999999999999999)).toBe("-0.9");
  });

  it("keeps no trailing zeros", () => {
    expect(formatCrisisEffectValue(-6)).toBe("-6");
    expect(formatCrisisEffectValue(0.5)).toBe("0.5");
    expect(formatCrisisEffectValue(-0.75)).toBe("-0.75");
  });

  it("leaves the sign to the caller, who may colour it instead", () => {
    expect(formatCrisisEffectValue(0.45)).toBe("0.45");
    expect(formatCrisisEffectValue(0)).toBe("0");
  });
});
