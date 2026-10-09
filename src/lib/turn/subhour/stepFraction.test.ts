import { describe, expect, it } from "vitest";
import {
  fractionalAlpha,
  hasSubhourStep,
  remainingStepFraction,
  subhourStepStamp,
} from "./stepFraction";

describe("subhour step contract", () => {
  it("applies the full step when the document was not stamped for this turn", () => {
    expect(remainingStepFraction(undefined, 10)).toBe(1);
    expect(remainingStepFraction(subhourStepStamp(9), 10)).toBe(1);
    expect(hasSubhourStep(subhourStepStamp(9), 10)).toBe(false);
  });

  it("applies the remainder after the half tick", () => {
    expect(remainingStepFraction(subhourStepStamp(10), 10)).toBe(0.5);
    expect(hasSubhourStep(subhourStepStamp(10), 10)).toBe(true);
  });

  it("clamps malformed fractions", () => {
    expect(remainingStepFraction({ turn: 10, fraction: 7 }, 10)).toBe(0);
    expect(remainingStepFraction({ turn: 10, fraction: Number.NaN }, 10)).toBe(1);
  });

  it("splits a smoothing coefficient so two halves equal one step", () => {
    const alpha = 0.678;
    const x = 2;
    let prev = 10;
    const full = prev + alpha * (x - prev);
    const a = fractionalAlpha(alpha, 0.5);
    prev = prev + a * (x - prev);
    prev = prev + a * (x - prev);
    expect(prev).toBeCloseTo(full, 12);
    expect(fractionalAlpha(alpha, 1)).toBe(alpha);
    expect(fractionalAlpha(alpha, 0)).toBe(0);
  });
});
