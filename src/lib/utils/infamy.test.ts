import { describe, it, expect } from "vitest";
import { infamyPenaltyMultiplier, INFAMY_PENALTY_MAX } from "./infamy";

describe("infamyPenaltyMultiplier", () => {
  it("returns 1.0 when infamy is null or undefined", () => {
    expect(infamyPenaltyMultiplier(null)).toBe(1);
    expect(infamyPenaltyMultiplier(undefined)).toBe(1);
  });

  it("returns 1.0 at infamy=0", () => {
    expect(infamyPenaltyMultiplier(0)).toBe(1);
  });

  it("returns 0.95 at infamy=100 (5% penalty cap)", () => {
    expect(infamyPenaltyMultiplier(100)).toBeCloseTo(0.95, 10);
  });

  it("scales linearly between 0 and 100", () => {
    expect(infamyPenaltyMultiplier(50)).toBeCloseTo(0.975, 10);
    expect(infamyPenaltyMultiplier(20)).toBeCloseTo(0.99, 10);
  });

  it("clamps negative infamy to 0", () => {
    expect(infamyPenaltyMultiplier(-50)).toBe(1);
  });

  it("clamps infamy above 100 to 100", () => {
    expect(infamyPenaltyMultiplier(200)).toBeCloseTo(0.95, 10);
  });

  it("INFAMY_PENALTY_MAX is 0.05", () => {
    expect(INFAMY_PENALTY_MAX).toBe(0.05);
  });

  it("returns 1.0 for NaN (treated as missing data)", () => {
    expect(infamyPenaltyMultiplier(NaN)).toBe(1);
  });

  it("returns 1.0 for Infinity / -Infinity (treated as missing data)", () => {
    expect(infamyPenaltyMultiplier(Infinity)).toBe(1);
    expect(infamyPenaltyMultiplier(-Infinity)).toBe(1);
  });
});
