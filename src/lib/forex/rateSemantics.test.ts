import { describe, expect, it } from "vitest";
import {
  computeRawRateVsReferencePercent,
  computeStrengthVsReferencePercent,
} from "@/lib/forex/rateSemantics";

describe("rateSemantics", () => {
  it("treats a lower current rate as stronger currency", () => {
    expect(computeStrengthVsReferencePercent(80, 100)).toBeCloseTo(25, 6);
    expect(computeRawRateVsReferencePercent(80, 100)).toBeCloseTo(-20, 6);
  });

  it("treats a higher current rate as weaker currency", () => {
    expect(computeStrengthVsReferencePercent(125, 100)).toBeCloseTo(-20, 6);
    expect(computeRawRateVsReferencePercent(125, 100)).toBeCloseTo(25, 6);
  });

  it("returns zero for invalid or non-positive inputs", () => {
    expect(computeStrengthVsReferencePercent(undefined, 100)).toBe(0);
    expect(computeStrengthVsReferencePercent(100, undefined)).toBe(0);
    expect(computeStrengthVsReferencePercent(0, 100)).toBe(0);
    expect(computeStrengthVsReferencePercent(100, 0)).toBe(0);
    expect(computeRawRateVsReferencePercent(Number.NaN, 100)).toBe(0);
    expect(computeRawRateVsReferencePercent(100, Number.NaN)).toBe(0);
  });
});
