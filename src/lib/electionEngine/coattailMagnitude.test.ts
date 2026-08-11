import { describe, it, expect } from "vitest";
import { approvalCoattailMultiplier, coattailMultiplierMapToPct } from "./coattailMagnitude";

describe("approvalCoattailMultiplier", () => {
  it("50% approval → neutral 1.0x", () => {
    expect(approvalCoattailMultiplier(50)).toBeCloseTo(1.0);
  });

  it("75% approval → +9% ceiling", () => {
    expect(approvalCoattailMultiplier(75)).toBeCloseTo(1.09);
  });

  it("25% approval → -9% drag", () => {
    expect(approvalCoattailMultiplier(25)).toBeCloseTo(0.91);
  });

  it("clamps beyond the ±25-point saturation", () => {
    expect(approvalCoattailMultiplier(100)).toBeCloseTo(1.09);
    expect(approvalCoattailMultiplier(0)).toBeCloseTo(0.91);
  });
});

describe("coattailMultiplierMapToPct", () => {
  it("converts multipliers to signed percentage tilts", () => {
    expect(coattailMultiplierMapToPct(new Map([["2", 1.045]]))["2"]).toBeCloseTo(4.5, 5);
  });

  it("empty map → empty record", () => {
    expect(coattailMultiplierMapToPct(new Map())).toEqual({});
  });
});
