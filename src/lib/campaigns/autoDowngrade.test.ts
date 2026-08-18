import { describe, it, expect } from "vitest";
import { computeAutoDowngrade } from "./autoDowngrade";
import type { Campaign } from "@/lib/db/types";

/** Legacy-level campaign (no started trees) — exercises the linear fallback. */
function legacy(groundGameLevel: number, mediaSpendingLevel: number): Campaign {
  return {
    fundraisingLevel: 0,
    oppositionResearchLevel: 0,
    groundGameLevel,
    mediaSpendingLevel,
  } as unknown as Campaign;
}

describe("computeAutoDowngrade — legacy level fallback", () => {
  it("no-ops for a solvent campaign", () => {
    const result = computeAutoDowngrade(legacy(3, 3), { funds: 1_000_000, income: 200_000 });
    expect(result.downgrades).toEqual([]);
    expect(result.setFields).toEqual({});
  });

  it("no-ops when projected funds exactly cover maintenance", () => {
    // Ground L1 ($5.5k) + Media L1 ($6k) = $11.5k maintenance
    const result = computeAutoDowngrade(legacy(1, 1), { funds: 1_500, income: 10_000 });
    expect(result.downgrades).toEqual([]);
  });

  it("drops media first when incremental maintenance is close (media higher)", () => {
    const result = computeAutoDowngrade(legacy(1, 1), { funds: 0, income: 0 });
    expect(result.downgrades[0]).toEqual({
      category: "mediaSpending",
      fromLevel: 1,
      toLevel: 0,
    });
    expect(result.setFields.mediaSpendingLevel).toBe(0);
  });

  it("drops the tier with higher incremental maintenance first", () => {
    // Ground L5 marginal = $170.5k; Media L3 marginal = $42k → ground drops first.
    const result = computeAutoDowngrade(legacy(5, 3), { funds: 0, income: 100_000 });
    expect(result.downgrades[0]).toEqual({
      category: "groundGame",
      fromLevel: 5,
      toLevel: 4,
    });
  });

  it("cascades multiple demotions until solvent", () => {
    const result = computeAutoDowngrade(legacy(5, 5), { funds: 0, income: 200_000 });
    expect(result.downgrades.length).toBeGreaterThan(0);
    expect(result.newMaintenance).toBeLessThanOrEqual(200_000);
    expect(result.setFields.groundGameLevel).toBeLessThan(5);
    expect(result.setFields.mediaSpendingLevel).toBeLessThan(5);
  });

  it("cascades to 0/0 when funds are deeply negative", () => {
    const result = computeAutoDowngrade(legacy(5, 5), { funds: -3_000_000, income: 200_000 });
    expect(result.setFields.groundGameLevel).toBe(0);
    expect(result.setFields.mediaSpendingLevel).toBe(0);
    expect(result.newMaintenance).toBe(0);
    expect(result.downgrades).toHaveLength(10);
  });

  it("forces the non-zero tier when one tier is already at 0", () => {
    const result = computeAutoDowngrade(legacy(0, 2), { funds: -100_000, income: 0 });
    expect(result.setFields.mediaSpendingLevel).toBe(0);
    expect(result.downgrades.every((d) => d.category === "mediaSpending")).toBe(true);
  });

  it("stops at 0/0 even if still insolvent", () => {
    const result = computeAutoDowngrade(legacy(2, 2), { funds: -5_000_000, income: 0 });
    expect(result.setFields.groundGameLevel).toBe(0);
    expect(result.setFields.mediaSpendingLevel).toBe(0);
    expect(result.newMaintenance).toBe(0);
  });

  it("returns zero demotions when both tiers are already at 0", () => {
    const result = computeAutoDowngrade(legacy(0, 0), { funds: -1_000_000, income: 50_000 });
    expect(result.downgrades).toEqual([]);
    expect(result.newMaintenance).toBe(0);
  });
});

describe("computeAutoDowngrade — branch trees", () => {
  function treeCampaign(
    partial: Partial<Pick<Campaign, "groundGameTree" | "mediaSpendingTree" | "fundraisingTree">>
  ): Campaign {
    return {
      fundraisingLevel: 0,
      oppositionResearchLevel: 0,
      groundGameLevel: 0,
      mediaSpendingLevel: 0,
      fundraisingTree: { starter: false, a: 0, b: 0, c: 0 },
      oppositionResearchTree: { starter: false, a: 0, b: 0, c: 0 },
      groundGameTree: { starter: false, a: 0, b: 0, c: 0 },
      mediaSpendingTree: { starter: false, a: 0, b: 0, c: 0 },
      ...partial,
    } as unknown as Campaign;
  }

  it("no-ops for a solvent tree campaign", () => {
    const c = treeCampaign({ groundGameTree: { starter: true, a: 2, b: 0, c: 0 } });
    const result = computeAutoDowngrade(c, { funds: 5_000_000, income: 0 });
    expect(result.downgrades).toEqual([]);
    expect(result.setFields).toEqual({});
  });

  it("demotes a maintenance-bearing branch tier when insolvent", () => {
    // Ground starter + Field Offices (a) L2 carries maintenance; force a cut.
    const c = treeCampaign({ groundGameTree: { starter: true, a: 2, b: 0, c: 0 } });
    const result = computeAutoDowngrade(c, { funds: 0, income: 0 });
    expect(result.downgrades.length).toBeGreaterThan(0);
    expect(result.downgrades[0]).toMatchObject({ category: "groundGame", branch: "a" });
    // Deeply insolvent (0 funds / 0 income): branch a sheds to 0, then the
    // starter is shed too, so the whole lever resets and upkeep reaches 0.
    expect(result.setFields["groundGameTree"]).toEqual({ starter: false, a: 0, b: 0, c: 0 });
    expect(result.newMaintenance).toBe(0);
  });

  it("keeps a partially-solvent branch investment instead of shedding everything", () => {
    // Field Offices L2 upkeep is $12k+$30k=$42k over starter $5.5k. With income
    // that covers the starter + L1 but not L2, only the top tier should shed.
    const c = treeCampaign({ groundGameTree: { starter: true, a: 2, b: 0, c: 0 } });
    const result = computeAutoDowngrade(c, { funds: 0, income: 20_000 });
    expect(result.setFields["groundGameTree.a"]).toBe(1);
    expect(result.setFields["groundGameTree"]).toBeUndefined();
    expect(result.newMaintenance).toBeLessThanOrEqual(20_000);
  });

  it("never demotes a zero-maintenance branch (Volunteer Corps)", () => {
    // Only branch c (maintReductionPct, no upkeep) is set — nothing to demote,
    // and starter upkeep alone can't be cut below the starter.
    const c = treeCampaign({ groundGameTree: { starter: true, a: 0, b: 0, c: 3 } });
    const result = computeAutoDowngrade(c, { funds: -1_000_000, income: 0 });
    expect(result.setFields["groundGameTree.c"]).toBeUndefined();
  });
});
