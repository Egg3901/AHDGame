import { describe, expect, it } from "vitest";
import {
  allocatePublicFloatAbsorption,
  calculateHourlyPublicFloatAbsorptionCap,
} from "./publicFloatAbsorption";

describe("calculateHourlyPublicFloatAbsorptionCap", () => {
  it("uses the plan's min(publicFloat, max(floor(totalShares / 100), 1)) formula", () => {
    expect(
      calculateHourlyPublicFloatAbsorptionCap({ totalShares: 1_200_000, publicFloat: 50_000 })
    ).toBe(12000);
    expect(calculateHourlyPublicFloatAbsorptionCap({ totalShares: 500, publicFloat: 100 })).toBe(5);
    expect(calculateHourlyPublicFloatAbsorptionCap({ totalShares: 10_000, publicFloat: 3 })).toBe(
      3
    );
  });

  it("returns zero for invalid or exhausted float inputs", () => {
    expect(calculateHourlyPublicFloatAbsorptionCap({ totalShares: 0, publicFloat: 100 })).toBe(0);
    expect(calculateHourlyPublicFloatAbsorptionCap({ totalShares: 10_000, publicFloat: 0 })).toBe(
      0
    );
  });
});

describe("allocatePublicFloatAbsorption", () => {
  it("splits capacity proportionally by target weight", () => {
    expect(
      allocatePublicFloatAbsorption(100, [
        { id: "broad", requestedShares: 100, weight: 0.7 },
        { id: "sector", requestedShares: 100, weight: 0.3 },
      ])
    ).toEqual([
      { id: "broad", requestedShares: 100, weight: 0.7, filledShares: 70 },
      { id: "sector", requestedShares: 100, weight: 0.3, filledShares: 30 },
    ]);
  });

  it("spills unused capacity to remaining allocations", () => {
    expect(
      allocatePublicFloatAbsorption(100, [
        { id: "small", requestedShares: 10, weight: 0.7 },
        { id: "large", requestedShares: 100, weight: 0.3 },
      ])
    ).toEqual([
      { id: "small", requestedShares: 10, weight: 0.7, filledShares: 10 },
      { id: "large", requestedShares: 100, weight: 0.3, filledShares: 90 },
    ]);
  });

  it("preserves whole-share caps with deterministic largest-remainder rounding", () => {
    const result = allocatePublicFloatAbsorption(5, [
      { id: "a", requestedShares: 10, weight: 1 },
      { id: "b", requestedShares: 10, weight: 1 },
      { id: "c", requestedShares: 10, weight: 1 },
    ]);

    expect(result.reduce((sum, item) => sum + item.filledShares, 0)).toBe(5);
    expect(result).toEqual([
      { id: "a", requestedShares: 10, weight: 1, filledShares: 2 },
      { id: "b", requestedShares: 10, weight: 1, filledShares: 2 },
      { id: "c", requestedShares: 10, weight: 1, filledShares: 1 },
    ]);
  });
});
