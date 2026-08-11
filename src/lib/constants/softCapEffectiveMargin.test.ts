import { describe, it, expect } from "vitest";
import { softCapEffectiveMargin, MARGIN_SOFT_CAP_KNEE, MARGIN_HARD_CEILING } from "./corporations";

describe("softCapEffectiveMargin", () => {
  it("is identity at or below the knee (ordinary sectors unchanged)", () => {
    for (const v of [-40, -0.1, 0, 35, 55, 79.9, MARGIN_SOFT_CAP_KNEE]) {
      expect(softCapEffectiveMargin(v)).toBe(v);
    }
  });

  it("compresses above the knee and stays under the ceiling across the realistic range", () => {
    // Real stacked margins top out around 120–150; the tanh saturates to the
    // ceiling in float only past ~480, far above anything the engine produces.
    for (const v of [85, 100, 130, 150, 200]) {
      const out = softCapEffectiveMargin(v);
      expect(out).toBeGreaterThan(MARGIN_SOFT_CAP_KNEE);
      expect(out).toBeLessThan(MARGIN_HARD_CEILING);
    }
  });

  it("is strictly monotonic across the knee (no flat target to pin)", () => {
    let prev = -Infinity;
    for (let v = 70; v <= 300; v += 2.5) {
      const out = softCapEffectiveMargin(v);
      expect(out).toBeGreaterThan(prev);
      prev = out;
    }
  });

  it("is continuous at the knee (no kink)", () => {
    const below = softCapEffectiveMargin(MARGIN_SOFT_CAP_KNEE - 1e-6);
    const above = softCapEffectiveMargin(MARGIN_SOFT_CAP_KNEE + 1e-6);
    expect(Math.abs(above - below)).toBeLessThan(1e-4);
  });

  it("guards non-finite input", () => {
    expect(softCapEffectiveMargin(NaN)).toBe(0);
    expect(softCapEffectiveMargin(Infinity)).toBeLessThan(MARGIN_HARD_CEILING);
  });
});
