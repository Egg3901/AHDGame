import { describe, expect, it } from "vitest";
import {
  CAPACITY_ANCHOR_YEAR,
  capacityPricePerUnit,
  revenuePerCapacityUnit,
  revenuePerCapacityUnitForStrategy,
} from "@/lib/constants/capacityEconomy";
import { GROWTH_COST_MULTIPLIER } from "@/lib/constants/corporations";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import type { CorporationType } from "@/lib/constants/corporations";

/**
 * The defect this file exists to prevent regressing.
 *
 * `capacityPricePerUnit` used to resolve RPU from the sector TYPE's default
 * ("standard") mix while revenue resolved it from the sector's ACTUAL strategy.
 * For extraction that is a 326.9x gap: the standard mix prices at RPU 89.23
 * because `rare_earth` (base price 21,000) is only 0.06% of its unit yield,
 * while `rare_earth_mining` earns RPU 29,166.67. Capacity bought at the
 * diversified price and pointed at rare earth paid its capex back in 0.22
 * turns instead of the intended 72.
 */
describe("capacityPricePerUnit is strategy-aware", () => {
  it("prices rare-earth capacity off the rare-earth RPU, not the standard mix", () => {
    const rare = capacityPricePerUnit("extraction", CAPACITY_ANCHOR_YEAR, 1, "rare_earth_mining");
    const standard = capacityPricePerUnit("extraction", CAPACITY_ANCHOR_YEAR, 1, "standard");
    // GROWTH_COST_MULTIPLIER and the era index cancel, so the price ratio must
    // be exactly the RPU ratio.
    expect(rare / standard).toBeCloseTo(
      revenuePerCapacityUnitForStrategy("extraction", "rare_earth_mining", 1) /
        revenuePerCapacityUnitForStrategy("extraction", "standard", 1),
      6
    );
    expect(rare / standard).toBeGreaterThan(300);
  });

  it("a null strategy still prices at the sector-type default", () => {
    expect(capacityPricePerUnit("extraction", CAPACITY_ANCHOR_YEAR, 1, null)).toBeCloseTo(
      capacityPricePerUnit("extraction", CAPACITY_ANCHOR_YEAR, 1, "standard"),
      6
    );
  });

  it("a null strategy reproduces the legacy sector-type price for every type", () => {
    // Guards the divergence risk between `defaultSupplyRates` (skips gated
    // strategies) and `getStrategy`'s own fallback: if these ever disagree, a
    // 3-arg legacy caller migrated to `null` would silently change price.
    for (const sectorType of Object.keys(SECTOR_STRATEGIES) as CorporationType[]) {
      const viaNull = capacityPricePerUnit(sectorType, CAPACITY_ANCHOR_YEAR, 1, null);
      const legacy = GROWTH_COST_MULTIPLIER * revenuePerCapacityUnit(sectorType, 1) * 1; // era index is 1.0 at the anchor
      expect(viaNull).toBeCloseTo(legacy, 6);
    }
  });
});

describe("capacity payback is uniform across every strategy", () => {
  it("every (type, strategy) pair repays its capacity in GROWTH_COST_MULTIPLIER days", () => {
    for (const [sectorType, strategies] of Object.entries(SECTOR_STRATEGIES)) {
      for (const strategy of strategies ?? []) {
        const price = capacityPricePerUnit(
          sectorType as CorporationType,
          CAPACITY_ANCHOR_YEAR,
          1,
          strategy.id
        );
        const revenuePerDay = revenuePerCapacityUnitForStrategy(
          sectorType as CorporationType,
          strategy.id,
          1
        );
        // A strategy with no priced output has no payback to assert.
        if (!(revenuePerDay > 0)) continue;
        expect(price / revenuePerDay).toBeCloseTo(GROWTH_COST_MULTIPLIER, 6);
      }
    }
  });
});
