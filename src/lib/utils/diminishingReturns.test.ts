import { describe, it, expect } from "vitest";
import { applyDiminishingReturns } from "./diminishingReturns";

describe("diminishingReturns", () => {
  it("applies full boost at 0% modifier", () => {
    expect(applyDiminishingReturns(0, 1.0)).toBe(1.0);
  });

  it("applies 50% boost at +10% modifier", () => {
    expect(applyDiminishingReturns(10, 1.0)).toBe(0.5);
  });

  it("applies 25% boost at +15% modifier", () => {
    expect(applyDiminishingReturns(15, 1.0)).toBe(0.25);
  });

  it("applies 0% boost at +20% modifier (hard cap)", () => {
    expect(applyDiminishingReturns(20, 1.0)).toBe(0);
  });

  it("works with negative modifiers", () => {
    expect(applyDiminishingReturns(-10, 1.0)).toBe(0.5);
  });

  it("caps at 20% (both positive and negative)", () => {
    expect(applyDiminishingReturns(20, 1.0)).toBe(0);
    expect(applyDiminishingReturns(-20, 1.0)).toBe(0);
    expect(applyDiminishingReturns(25, 1.0)).toBe(0); // over cap
  });
});
