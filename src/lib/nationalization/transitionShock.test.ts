import { describe, it, expect } from "vitest";
import { nationalizationProductivityFactor } from "./transitionShock";
import { NATIONALIZATION_PRODUCTIVITY_HIT, NATIONALIZATION_TRANSITION_TURNS } from "./constants";

describe("nationalizationProductivityFactor", () => {
  it("applies the full drag at the turn of nationalization", () => {
    expect(nationalizationProductivityFactor(100, 100)).toBeCloseTo(
      1 - NATIONALIZATION_PRODUCTIVITY_HIT,
      5
    );
  });

  it("decays linearly toward 1.0 across the window", () => {
    const half = NATIONALIZATION_TRANSITION_TURNS / 2; // 60
    expect(nationalizationProductivityFactor(100, 100 + half)).toBeCloseTo(
      1 - NATIONALIZATION_PRODUCTIVITY_HIT / 2,
      5
    );
  });

  it("returns 1.0 at and beyond the window end", () => {
    expect(nationalizationProductivityFactor(100, 100 + NATIONALIZATION_TRANSITION_TURNS)).toBe(1);
    expect(nationalizationProductivityFactor(100, 100 + 999)).toBe(1);
  });

  it("returns 1.0 for missing anchor or turn", () => {
    expect(nationalizationProductivityFactor(undefined, 100)).toBe(1);
    expect(nationalizationProductivityFactor(null, 100)).toBe(1);
    expect(nationalizationProductivityFactor(100, undefined)).toBe(1);
  });

  it("returns 1.0 when the anchor is in the future (negative elapsed)", () => {
    expect(nationalizationProductivityFactor(120, 100)).toBe(1);
  });

  it("a high-SOCI taking digests deeper and longer", () => {
    // At taking turn, the deepened hit exceeds the base 15% (capped).
    const baseAtStart = 1 - nationalizationProductivityFactor(100, 100); // 0.15
    const deepAtStart = 1 - nationalizationProductivityFactor(100, 100, 2.5);
    expect(deepAtStart).toBeGreaterThan(baseAtStart);

    // Past the base 120-turn window the base shock is gone, but a 2.5× window
    // (300 turns) is still recovering.
    expect(nationalizationProductivityFactor(100, 100 + 121, 1)).toBe(1);
    expect(nationalizationProductivityFactor(100, 100 + 121, 2.5)).toBeLessThan(1);
  });

  it("the deepened hit is capped (output never drops below the floor)", () => {
    const factor = nationalizationProductivityFactor(100, 100, 100); // absurd multiplier
    expect(factor).toBeGreaterThanOrEqual(1 - 0.5); // NATIONALIZATION_MAX_TRANSITION_HIT
  });

  it("multiplier 1 is identical to the current behavior", () => {
    expect(nationalizationProductivityFactor(100, 130, 1)).toBe(
      nationalizationProductivityFactor(100, 130)
    );
  });
});
