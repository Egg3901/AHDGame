import { describe, expect, it } from "vitest";
import {
  EXTRACTION_CAPACITY_HAIRCUT_TURNS,
  EXTRACTION_CAPACITY_HAIRCUT_FLOOR,
  capacityHaircutFactor,
  haircutScarcityRelief,
  weightedCapacityUtilization,
} from "./capacityHaircut";

describe("weightedCapacityUtilization", () => {
  it("returns full utilization when there is no extractable output", () => {
    expect(weightedCapacityUtilization({}, undefined)).toEqual({
      utilization: 1,
      bindingResource: null,
    });
  });

  it("returns 1 and no binding resource when unconstrained (missing multipliers = uncapped)", () => {
    const r = weightedCapacityUtilization({ iron: 0.4, coal: 0.3 }, undefined);
    expect(r.utilization).toBe(1);
    expect(r.bindingResource).toBeNull();
  });

  it("weights utilization by supply rate and reports the most-binding resource", () => {
    // iron rate 0.4 at 0.25 mult, coal rate 0.1 at 1.0 mult
    // weighted = (0.4*0.25 + 0.1*1) / 0.5 = (0.1 + 0.1) / 0.5 = 0.4
    const r = weightedCapacityUtilization({ iron: 0.4, coal: 0.1 }, { iron: 0.25, coal: 1 });
    expect(r.utilization).toBeCloseTo(0.4, 5);
    expect(r.bindingResource).toBe("iron");
  });

  it("does not report a binding resource when all multipliers are 1", () => {
    const r = weightedCapacityUtilization({ iron: 0.4 }, { iron: 1 });
    expect(r.utilization).toBe(1);
    expect(r.bindingResource).toBeNull();
  });
});

describe("capacityHaircutFactor", () => {
  it("is 1 (no haircut) when fully utilized", () => {
    expect(capacityHaircutFactor(1, 100, 200)).toBe(1);
  });

  it("is 1 at the start turn and ramps to full utilization over the window", () => {
    const util = 0.4;
    const start = 1000;
    expect(capacityHaircutFactor(util, start, start)).toBe(1); // no time elapsed
    // Halfway through the window: haircut is half-applied.
    const half = start + EXTRACTION_CAPACITY_HAIRCUT_TURNS / 2;
    expect(capacityHaircutFactor(util, start, half)).toBeCloseTo(1 - 0.5 * (1 - util), 5); // 0.7
    // Fully through: factor equals utilization.
    const full = start + EXTRACTION_CAPACITY_HAIRCUT_TURNS;
    expect(capacityHaircutFactor(util, start, full)).toBeCloseTo(util, 5);
    // Past the window: clamped at utilization, no further decline.
    expect(capacityHaircutFactor(util, start, full + 500)).toBeCloseTo(util, 5);
  });

  it("returns 1 when the start turn is unknown", () => {
    expect(capacityHaircutFactor(0.4, null, 1200)).toBe(1);
    expect(capacityHaircutFactor(0.4, undefined, 1200)).toBe(1);
  });

  it("clamps the fully-ramped factor to the floor when one is passed", () => {
    const util = 0.071; // prod rev-weighted extraction utilization
    const start = 100;
    const full = start + EXTRACTION_CAPACITY_HAIRCUT_TURNS;
    // Unfloored: fully-ramped factor equals utilization (~-93%).
    expect(capacityHaircutFactor(util, start, full)).toBeCloseTo(util, 5);
    // Floored at 0.5: the worst case is capped at -50%.
    expect(capacityHaircutFactor(util, start, full, EXTRACTION_CAPACITY_HAIRCUT_FLOOR)).toBe(
      EXTRACTION_CAPACITY_HAIRCUT_FLOOR
    );
    // The floor never raises a factor that is already above it (mid-ramp, util 0.8).
    const mid = start + EXTRACTION_CAPACITY_HAIRCUT_TURNS / 2;
    expect(capacityHaircutFactor(0.8, start, mid, EXTRACTION_CAPACITY_HAIRCUT_FLOOR)).toBeCloseTo(
      0.9,
      5
    );
    // Default floor (0) leaves other callers unchanged.
    expect(capacityHaircutFactor(util, start, full)).toBeCloseTo(util, 5);
  });
});

describe("haircutScarcityRelief", () => {
  it("gives full relief at or below s/d 0.5", () => {
    expect(haircutScarcityRelief(2404, 9950)).toBe(1); // rare earth t899 (0.24)
    expect(haircutScarcityRelief(50, 100)).toBe(1);
  });

  it("gives no relief at or above s/d 1.0 (glut or balance)", () => {
    expect(haircutScarcityRelief(100, 100)).toBe(0);
    expect(haircutScarcityRelief(200, 100)).toBe(0);
  });

  it("interpolates linearly between 0.5 and 1.0", () => {
    expect(haircutScarcityRelief(75, 100)).toBeCloseTo(0.5, 10);
    expect(haircutScarcityRelief(60, 100)).toBeCloseTo(0.8, 10);
  });

  it("returns 0 for missing or degenerate balances", () => {
    expect(haircutScarcityRelief(undefined, 100)).toBe(0);
    expect(haircutScarcityRelief(100, undefined)).toBe(0);
    expect(haircutScarcityRelief(100, 0)).toBe(0);
  });
});
