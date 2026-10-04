import { describe, expect, it } from "vitest";
import {
  getEffectiveStrategyRates,
  getEffectiveStrategyRatesForOperatingModel,
  getOperatingSectorType,
  getStrategy,
  getStrategyForOperatingModel,
} from "./sectorStrategies";

describe("manufacturing vehicle operating model", () => {
  it("resolves vehicle recipes from a manufacturing sector without changing generic manufacturing", () => {
    const vehicle = getStrategyForOperatingModel("manufacturing", "standard", "vehicles");
    const legacy = getStrategy("automobiles", "standard");
    const generic = getStrategyForOperatingModel("manufacturing", "standard");

    expect(vehicle).toEqual(legacy);
    expect(generic).toEqual(getStrategy("manufacturing", "standard"));
    expect(generic.supply).not.toEqual(vehicle.supply);
    expect(generic.demand).not.toEqual(vehicle.demand);
  });

  it("keeps legacy automobile strategy identifiers and recipe rows readable", () => {
    expect(getStrategy("automobiles", "ev")).toEqual(
      getStrategyForOperatingModel("manufacturing", "ev", "vehicles")
    );
    expect(getStrategy("automobiles", "heavy_machinery").supply).toEqual({ vehicles: 0.55 });
  });

  it("uses the vehicle recipes on both sides of an in-progress strategy transition", () => {
    const modeled = getEffectiveStrategyRatesForOperatingModel(
      "manufacturing",
      "ev",
      "standard",
      100,
      106,
      "vehicles"
    );
    const legacy = getEffectiveStrategyRates("automobiles", "ev", "standard", 100, 106);

    expect(modeled).toEqual(legacy);
    expect(modeled.isTransitioning).toBe(true);
    expect(modeled.supply.vehicles).toBeCloseTo((0.5 + 0.45) / 2);
  });
});

describe("canonical entertainment media identity", () => {
  it("resolves strategy lookup and rates through the legacy entertainment recipe", () => {
    expect(getOperatingSectorType("media", null, "entertainment")).toBe("entertainment");
    expect(getStrategyForOperatingModel("media", "film_studio", null, "entertainment")).toEqual(
      getStrategy("entertainment", "film_studio")
    );
    expect(
      getEffectiveStrategyRatesForOperatingModel(
        "media",
        "film_studio",
        null,
        null,
        1,
        null,
        "entertainment"
      )
    ).toEqual(
      getEffectiveStrategyRatesForOperatingModel("entertainment", "film_studio", null, null, 1)
    );
  });
});
