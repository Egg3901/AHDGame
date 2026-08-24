import { describe, expect, it } from "vitest";
import { computeContractProduction } from "./contractProduction";

describe("computeContractProduction", () => {
  it("keeps voluntary throttling out of the damage ceiling", () => {
    const result = computeContractProduction({
      plantsEnabled: true,
      actualNameplateUnits: 100,
      actualProductionFactor: 0.5,
      fullPolicyNameplateUnits: 100,
      involuntaryProductionFactor: 1,
      priorSoldUnits: 100,
      priorProducedUnits: 100,
      soldFraction: 1,
    });

    expect(result.producedUnits).toBe(50);
    expect(result.contractAchievableUnits).toBe(100);
  });

  it("keeps mothballing out of the damage ceiling", () => {
    const result = computeContractProduction({
      plantsEnabled: true,
      actualNameplateUnits: 0,
      actualProductionFactor: 1,
      fullPolicyNameplateUnits: 100,
      involuntaryProductionFactor: 0.8,
      priorSoldUnits: 100,
      priorProducedUnits: 100,
      soldFraction: 1,
    });

    expect(result.producedUnits).toBe(0);
    expect(result.contractAchievableUnits).toBe(80);
  });

  it("applies the market demand throttle to the damage ceiling", () => {
    const result = computeContractProduction({
      plantsEnabled: true,
      actualNameplateUnits: 100,
      actualProductionFactor: 1,
      fullPolicyNameplateUnits: 100,
      involuntaryProductionFactor: 1,
      priorSoldUnits: 20,
      priorProducedUnits: 100,
      soldFraction: 0.2,
    });

    expect(result.producedUnits).toBeCloseTo(23, 8);
    expect(result.contractAchievableUnits).toBeCloseTo(23, 8);
  });
});
