import { describe, it, expect } from "vitest";
import {
  sectorInputCostIndex,
  costPassThroughMultiplier,
  COST_PASS_THROUGH_BETA,
  COST_PASS_THROUGH_CAP,
} from "./costPassThrough";
import { SECTOR_DEMAND } from "@/lib/constants/commodities";
import type { CommodityType } from "@/lib/constants/commodities";

const ratios = (entries: Partial<Record<CommodityType, number>>) =>
  new Map(Object.entries(entries)) as Map<CommodityType, number>;

describe("sectorInputCostIndex", () => {
  it("is 1 at base prices", () => {
    expect(sectorInputCostIndex("agriculture", ratios({}))).toBe(1);
  });

  it("weights each input by its recipe rate", () => {
    // Only fertilizers moved: index = (0.15 x 2 + rest x 1) / totalRate.
    const recipe = SECTOR_DEMAND.agriculture!;
    const totalRate = recipe.reduce((s, r) => s + r.rate, 0);
    const fert = recipe.find((r) => r.commodity === "fertilizers")!.rate;
    const expected = (fert * 2 + (totalRate - fert)) / totalRate;
    expect(sectorInputCostIndex("agriculture", ratios({ fertilizers: 2 }))).toBeCloseTo(
      expected,
      10
    );
  });
});

describe("costPassThroughMultiplier", () => {
  it("is exactly 1 when producer inputs are at or below base", () => {
    // FLOOR: cheap inputs never discount the price below the S/D engine's own.
    expect(costPassThroughMultiplier("food", ratios({ fertilizers: 0.4, energy: 0.5 }))).toBe(1);
    expect(costPassThroughMultiplier("food", ratios({}))).toBe(1);
  });

  it("extraction outputs inherit the energy squeeze, damped", () => {
    // A mine paying 5x for energy passes part of that into ore. The multiplier
    // must be above 1 but strictly less than the raw input index — the
    // producer eats BETA's complement of the squeeze.
    const r = ratios({ energy: 5 });
    const m = costPassThroughMultiplier("iron", r);
    expect(m).toBeGreaterThan(1);
    expect(m).toBeLessThanOrEqual(COST_PASS_THROUGH_CAP);
  });

  it("passes through half the producer's cost squeeze", () => {
    // The prod incident shape: fertilizers 2.26x, plastics 1.60x, freight
    // 1.61x. Food's multiplier must be 1 + BETA x (index - 1), damped, not the
    // full squeeze.
    const r = ratios({ fertilizers: 2.26, plastics: 1.6, freight: 1.61 });
    const index = sectorInputCostIndex("agriculture", r);
    expect(index).toBeGreaterThan(1.2);
    const m = costPassThroughMultiplier("food", r);
    expect(m).toBeCloseTo(1 + COST_PASS_THROUGH_BETA * (index - 1), 10);
    expect(m).toBeLessThan(index); // damped, producers still eat part of it
  });

  it("caps runaway chains", () => {
    const everythingExpensive = ratios(
      Object.fromEntries(SECTOR_DEMAND.agriculture!.map((r) => [r.commodity, 10]))
    );
    expect(costPassThroughMultiplier("food", everythingExpensive)).toBe(COST_PASS_THROUGH_CAP);
  });
});
