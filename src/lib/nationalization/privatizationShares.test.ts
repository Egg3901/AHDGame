import { describe, expect, it } from "vitest";
import { computeSpunOutShareStructure, isWithinRenationalizeCooldown } from "./privatizationShares";
import { GOLDEN_SHARE_MAX, RENATIONALIZE_COOLDOWN_TURNS } from "./constants";

describe("computeSpunOutShareStructure", () => {
  it("derives price from valuation and floats the non-golden remainder", () => {
    // 10M shares; valuationLocal 5,000,000 ⇒ price 0.50; golden 20% ⇒ 2M golden, 8M float.
    const s = computeSpunOutShareStructure({ valuationLocal: 5_000_000, goldenSharePercent: 0.2 });
    expect(s.totalShares).toBe(10_000_000);
    expect(s.sharePrice).toBeCloseTo(0.5, 2);
    expect(s.goldenShares).toBe(2_000_000);
    expect(s.floatShares).toBe(8_000_000);
    expect(s.proceedsLocal).toBe(Math.round(8_000_000 * 0.5));
  });

  it("with zero golden share, floats everything", () => {
    const s = computeSpunOutShareStructure({ valuationLocal: 1_000_000, goldenSharePercent: 0 });
    expect(s.goldenShares).toBe(0);
    expect(s.floatShares).toBe(s.totalShares);
  });

  it("clamps golden share to GOLDEN_SHARE_MAX", () => {
    const s = computeSpunOutShareStructure({ valuationLocal: 1_000_000, goldenSharePercent: 0.99 });
    expect(s.goldenShares).toBe(Math.round(s.totalShares * GOLDEN_SHARE_MAX));
  });

  it("floors share price at MIN_SHARE_PRICE for a near-zero valuation", () => {
    const s = computeSpunOutShareStructure({ valuationLocal: 1, goldenSharePercent: 0 });
    expect(s.sharePrice).toBe(0.01);
  });

  it("treats a negative valuation as zero (price floored, never NaN)", () => {
    const s = computeSpunOutShareStructure({ valuationLocal: -500, goldenSharePercent: 0 });
    expect(s.sharePrice).toBe(0.01);
    expect(s.proceedsLocal).toBeGreaterThanOrEqual(0);
  });
});

describe("isWithinRenationalizeCooldown", () => {
  it("is true within the window after privatization", () => {
    expect(
      isWithinRenationalizeCooldown(
        { privatizedAtTurn: 100 },
        100 + RENATIONALIZE_COOLDOWN_TURNS - 1
      )
    ).toBe(true);
  });

  it("is false at/after the window, or when never privatized", () => {
    expect(
      isWithinRenationalizeCooldown({ privatizedAtTurn: 100 }, 100 + RENATIONALIZE_COOLDOWN_TURNS)
    ).toBe(false);
    expect(isWithinRenationalizeCooldown({}, 999)).toBe(false);
  });
});
