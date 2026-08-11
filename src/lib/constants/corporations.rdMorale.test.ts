import { describe, expect, it } from "vitest";
import { rdMoraleFactor, RD_MORALE_MAX_SWING } from "./corporations";

describe("rdMoraleFactor — worker morale → R&D efficiency (#84)", () => {
  it("is neutral at baseline pay (wageLevel 1)", () => {
    expect(rdMoraleFactor(1)).toBe(1);
  });

  it("rewards paying above baseline, up to the band", () => {
    // 1 + 0.5 * (1.2 - 1) = 1.10
    expect(rdMoraleFactor(1.2)).toBeCloseTo(1.1, 10);
    // Extreme pay clamps at +band.
    expect(rdMoraleFactor(5)).toBe(1 + RD_MORALE_MAX_SWING);
  });

  it("penalizes paying below baseline, down to the band", () => {
    // 1 + 0.5 * (0.8 - 1) = 0.90
    expect(rdMoraleFactor(0.8)).toBeCloseTo(0.9, 10);
    // Extreme wage cut clamps at -band.
    expect(rdMoraleFactor(0)).toBe(1 - RD_MORALE_MAX_SWING);
  });
});
