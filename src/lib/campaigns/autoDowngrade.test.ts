import { describe, it, expect } from "vitest";
import { computeAutoDowngrade } from "./autoDowngrade";

describe("computeAutoDowngrade", () => {
  it("no-ops for a solvent campaign", () => {
    const result = computeAutoDowngrade({
      funds: 1_000_000,
      income: 200_000,
      groundGameLevel: 3,
      mediaSpendingLevel: 3,
    });
    expect(result.downgrades).toEqual([]);
    expect(result.newGroundGameLevel).toBe(3);
    expect(result.newMediaSpendingLevel).toBe(3);
  });

  it("no-ops when projected funds exactly cover maintenance", () => {
    // Ground L1 ($5.5k) + Media L1 ($6k) = $11.5k maintenance
    const result = computeAutoDowngrade({
      funds: 1_500,
      income: 10_000,
      groundGameLevel: 1,
      mediaSpendingLevel: 1,
    });
    expect(result.downgrades).toEqual([]);
  });

  it("drops media first when incremental maintenance is equal", () => {
    // At L1 both tiers have similar-but-different marginal: ground=$5.5k, media=$6k.
    // Media is higher, so it drops first.
    const result = computeAutoDowngrade({
      funds: 0,
      income: 0,
      groundGameLevel: 1,
      mediaSpendingLevel: 1,
    });
    expect(result.downgrades[0]).toEqual({
      category: "mediaSpending",
      fromLevel: 1,
      toLevel: 0,
    });
  });

  it("drops the tier with higher incremental maintenance first", () => {
    // Ground L5 marginal = $170.5k; Media L3 marginal = $42k.
    // Ground should drop first.
    const result = computeAutoDowngrade({
      funds: 0,
      income: 100_000,
      groundGameLevel: 5,
      mediaSpendingLevel: 3,
    });
    expect(result.downgrades[0]).toEqual({
      category: "groundGame",
      fromLevel: 5,
      toLevel: 4,
    });
  });

  it("cascades multiple demotions until solvent", () => {
    // Deprince-like scenario: L5/L5 with $200k income, insolvent.
    // Needs to drop to where maintenance <= $200k projected.
    const result = computeAutoDowngrade({
      funds: 0,
      income: 200_000,
      groundGameLevel: 5,
      mediaSpendingLevel: 5,
    });
    expect(result.downgrades.length).toBeGreaterThan(0);
    expect(result.newMaintenance).toBeLessThanOrEqual(200_000);
    expect(result.newGroundGameLevel).toBeLessThan(5);
    expect(result.newMediaSpendingLevel).toBeLessThan(5);
  });

  it("cascades to 0/0 when funds are deeply negative", () => {
    // -$3M matches the Deprince bug; everything should drop to zero.
    const result = computeAutoDowngrade({
      funds: -3_000_000,
      income: 200_000,
      groundGameLevel: 5,
      mediaSpendingLevel: 5,
    });
    expect(result.newGroundGameLevel).toBe(0);
    expect(result.newMediaSpendingLevel).toBe(0);
    expect(result.newMaintenance).toBe(0);
    expect(result.downgrades).toHaveLength(10);
  });

  it("forces the non-zero tier when one tier is already at 0", () => {
    const result = computeAutoDowngrade({
      funds: -100_000,
      income: 0,
      groundGameLevel: 0,
      mediaSpendingLevel: 2,
    });
    expect(result.newGroundGameLevel).toBe(0);
    expect(result.newMediaSpendingLevel).toBe(0);
    expect(result.downgrades.every((d) => d.category === "mediaSpending")).toBe(true);
  });

  it("stops at 0/0 even if still insolvent", () => {
    // Deep deficit with no income — loop must still terminate.
    const result = computeAutoDowngrade({
      funds: -5_000_000,
      income: 0,
      groundGameLevel: 2,
      mediaSpendingLevel: 2,
    });
    expect(result.newGroundGameLevel).toBe(0);
    expect(result.newMediaSpendingLevel).toBe(0);
    expect(result.newMaintenance).toBe(0);
  });

  it("returns zero demotions when both tiers are already at 0", () => {
    const result = computeAutoDowngrade({
      funds: -1_000_000,
      income: 50_000,
      groundGameLevel: 0,
      mediaSpendingLevel: 0,
    });
    expect(result.downgrades).toEqual([]);
    expect(result.newMaintenance).toBe(0);
  });
});
