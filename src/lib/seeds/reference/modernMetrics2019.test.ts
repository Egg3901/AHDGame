import { describe, expect, it } from "vitest";
import { modernMetrics2019 } from "./modernMetrics2019";
import { modernRegions2019 } from "./modernRegions2019";

describe("2019 transition-region metrics", () => {
  it.each(["RU", "PL", "HU", "RO", "BG"] as const)(
    "%s covers exactly its 2019 regions with observed national indicators",
    (countryId) => {
      const regions = modernRegions2019(countryId);
      const metrics = modernMetrics2019(countryId);
      expect(metrics.map((metric) => metric._id).sort()).toEqual(
        regions.map((region) => region._id).sort()
      );
      expect(metrics.every((metric) => metric.countryId === countryId)).toBe(true);
      expect(metrics.every((metric) => metric.economic.medianIncome.value > 0)).toBe(true);
      expect(metrics.every((metric) => metric.healthcare.lifeExpectancy.value > 70)).toBe(true);
      expect(metrics.every((metric) => metric.population.urbanizationRate.value > 50)).toBe(true);
    }
  );
});
