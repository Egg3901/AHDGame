import { describe, it, expect } from "vitest";
import { computeIpoIssuance } from "./ipoIssuance";

describe("computeIpoIssuance", () => {
  it("issues new shares so floatPct of post-IPO totalShares equals the requested float", () => {
    const result = computeIpoIssuance({
      existingShares: 10_000_000,
      pricePerShare: 0.5,
      floatPct: 30,
    });
    // 10M founder × 30/70 ≈ 4,285,714 new shares
    expect(result.newShares).toBe(4_285_714);
    // proceeds = newShares × price
    expect(result.proceeds).toBeCloseTo(2_142_857, 0);
    expect(result.totalSharesAfter).toBe(14_285_714);
    expect(result.founderOwnershipPctAfter).toBeCloseTo(70, 1);
  });

  it("at 49% float (max), founder retains just over 51%", () => {
    const result = computeIpoIssuance({
      existingShares: 10_000_000,
      pricePerShare: 1.0,
      floatPct: 49,
    });
    expect(result.founderOwnershipPctAfter).toBeGreaterThan(50);
    expect(result.founderOwnershipPctAfter).toBeLessThan(52);
  });

  it("at 10% float (min), founder retains 90%", () => {
    const result = computeIpoIssuance({
      existingShares: 10_000_000,
      pricePerShare: 0.5,
      floatPct: 10,
    });
    expect(result.newShares).toBe(1_111_111);
    expect(result.founderOwnershipPctAfter).toBeCloseTo(90, 1);
  });

  it("rounds new shares down (no fractional shares issued)", () => {
    const result = computeIpoIssuance({
      existingShares: 10_000_000,
      pricePerShare: 0.5,
      floatPct: 33,
    });
    // 10M × 33/67 = 4,925,373.13... → 4,925,373
    expect(result.newShares).toBe(4_925_373);
  });

  it("throws if floatPct is out of range", () => {
    expect(() =>
      computeIpoIssuance({ existingShares: 10_000_000, pricePerShare: 0.5, floatPct: 9 })
    ).toThrow();
    expect(() =>
      computeIpoIssuance({ existingShares: 10_000_000, pricePerShare: 0.5, floatPct: 50 })
    ).toThrow();
  });

  it("throws if existingShares or pricePerShare are non-positive", () => {
    expect(() =>
      computeIpoIssuance({ existingShares: 0, pricePerShare: 0.5, floatPct: 30 })
    ).toThrow();
    expect(() =>
      computeIpoIssuance({ existingShares: 10_000_000, pricePerShare: 0, floatPct: 30 })
    ).toThrow();
  });
});
