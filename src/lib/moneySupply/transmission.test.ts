import { describe, expect, it } from "vitest";
import { calculateInflationWithBreakdown, type InflationInputs } from "@/lib/budget/inflation";
import { applyQePriceSupport } from "./quantitativeEasing";

const stableEconomy: InflationInputs = {
  targetInflation: 2,
  neutralPrimeRate: 3,
  unemployment: 5,
  gdpGrowth: 2,
  primeRate: 3,
  surplusToGdp: 0,
  tariffRate: 3,
  wageGrowth: 2.5,
  commodityPressure: 0,
  forexPressure: 0,
  savingsPressure: 0,
  previousInflation: 2,
};

describe("monetary transmission", () => {
  it("turns excess M2 growth into a bounded visible inflation contribution", () => {
    const stable = calculateInflationWithBreakdown({
      ...stableEconomy,
      moneySupplyGrowthPct: 2,
    });
    const expansion = calculateInflationWithBreakdown({
      ...stableEconomy,
      moneySupplyGrowthPct: 12,
    });

    expect(stable.breakdown.moneySupply).toBe(0);
    expect(expansion.breakdown.moneySupply).toBeCloseTo(0.8);
    expect(expansion.rate).toBeGreaterThan(stable.rate);
  });

  it("QE demand support raises a sovereign bond price and therefore lowers its yield", () => {
    expect(applyQePriceSupport(0.9, 0.2)).toBeCloseTo(0.99);
    expect(applyQePriceSupport(0.9, 0)).toBe(0.9);
  });
});
