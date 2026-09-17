import { describe, expect, it } from "vitest";
import type { SectorStrategy } from "@/lib/constants/sectorStrategies";
import { analyzeStrategyViability, evaluateRecipeScenario } from "./sectorViability";

const strategy = (demand: SectorStrategy["demand"]): SectorStrategy => ({
  id: "test",
  name: "Test",
  description: "Test recipe",
  supply: { vehicles: 0.5 },
  demand,
});

describe("sector viability", () => {
  it("uses the same damped price realization on inputs and outputs", () => {
    const result = evaluateRecipeScenario(strategy({ steel: 0.4 }), 1.25, 0.75);
    expect(result.revenueShare).toBeCloseTo(Math.sqrt(0.75));
    expect(result.inputCostShare).toBeCloseTo(0.4 * Math.sqrt(1.25));
  });

  it("separates impossible recipes from bounded stress failures", () => {
    expect(analyzeStrategyViability("automobiles", strategy({ steel: 1.01 })).status).toBe(
      "impossible_at_balance"
    );
    expect(analyzeStrategyViability("automobiles", strategy({ steel: 0.8 })).status).toBe(
      "stress_sensitive"
    );
    expect(analyzeStrategyViability("automobiles", strategy({ steel: 0.4 })).status).toBe("viable");
  });

  it("does not invent a recipe-level utilization break-even", () => {
    const result = analyzeStrategyViability("automobiles", strategy({ steel: 0.4 }));
    expect(result.breakEvenUtilization).toBeNull();
    expect(result.balancedOutputRate).toBe(0.5);
  });
});
