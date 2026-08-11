import { describe, it, expect } from "vitest";
import { applyAusterityCap } from "../austerity";

describe("applyAusterityCap", () => {
  it("returns spending unchanged when revenue >= total", () => {
    const result = applyAusterityCap(
      { byCategory: { defense: 100, social: 200 }, stateGrants: 50, debtInterest: 25, total: 375 },
      500
    );
    expect(result.scaleFactor).toBe(1);
    expect(result.scaledByCategory).toEqual({ defense: 100, social: 200 });
    expect(result.scaledStateGrants).toBe(50);
    expect(result.scaledDebtInterest).toBe(25);
    expect(result.scaledTotal).toBe(375);
  });

  it("scales every category proportionally when total > revenue", () => {
    const result = applyAusterityCap(
      {
        byCategory: { defense: 200, social: 200 },
        stateGrants: 100,
        debtInterest: 100,
        total: 600,
      },
      300
    );
    expect(result.scaleFactor).toBeCloseTo(0.5);
    expect(result.scaledByCategory).toEqual({ defense: 100, social: 100 });
    expect(result.scaledStateGrants).toBe(50);
    expect(result.scaledDebtInterest).toBe(50);
    expect(result.scaledTotal).toBeCloseTo(300);
  });

  it("returns passthrough when total is 0 (no division by zero)", () => {
    const result = applyAusterityCap(
      { byCategory: {}, stateGrants: 0, debtInterest: 0, total: 0 },
      100
    );
    expect(result.scaleFactor).toBe(1);
    expect(result.scaledTotal).toBe(0);
  });

  it("clamps scaleFactor to 0 when revenue is negative (defensive)", () => {
    const result = applyAusterityCap(
      { byCategory: { defense: 100 }, stateGrants: 0, debtInterest: 0, total: 100 },
      -50
    );
    expect(result.scaleFactor).toBe(0);
    expect(result.scaledByCategory).toEqual({ defense: 0 });
    expect(result.scaledTotal).toBe(0);
  });
});
