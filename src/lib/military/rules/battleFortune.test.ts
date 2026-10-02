import { describe, expect, it } from "vitest";
import { applyReserveOdds, battleEffectiveRatio } from "./battleFortune";

describe("applyReserveOdds", () => {
  it("cancels equal reserves and moves odds toward the side with the advantage", () => {
    expect(applyReserveOdds(0.5, 1, 1)).toBe(0.5);
    expect(applyReserveOdds(0.5, 1, 0)).toBeCloseTo(0.6);
    expect(applyReserveOdds(0.5, 0, 1)).toBeCloseTo(0.4);
  });

  it("bounds malformed reserve inputs instead of producing impossible odds", () => {
    expect(applyReserveOdds(Number.NaN, Number.POSITIVE_INFINITY, -3)).toBe(0.5);
    expect(applyReserveOdds(2, 4, 0)).toBe(0.98);
  });
});

describe("battleEffectiveRatio", () => {
  it("keeps the outcome direction but caps severity", () => {
    expect(battleEffectiveRatio(0.5, 1, 0.5, 0.18)).toBeCloseTo(0.68);
    expect(battleEffectiveRatio(0.5, 0, 0.5, 0.18)).toBeCloseTo(0.32);
    expect(battleEffectiveRatio(0.5, 0.51, 0.5, 0.18)).toBeCloseTo(0.51);
  });

  it("never lets invalid or future tuning invert damage into healing", () => {
    expect(battleEffectiveRatio(0.5, 1, 0.5, 99)).toBe(1);
    expect(battleEffectiveRatio(Number.NaN, Number.NaN, Number.NaN, Number.NaN)).toBe(0.5);
  });
});
