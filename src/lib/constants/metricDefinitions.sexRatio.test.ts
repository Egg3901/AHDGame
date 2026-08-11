import { describe, expect, it } from "vitest";
import { metricCategories } from "./metricDefinitions";

describe("sexRatio + dependencyRatio population metric definitions", () => {
  const population = metricCategories.find((c) => c.id === "population");

  it("surfaces sexRatio under the population category as a 0-100 share-male readout", () => {
    const m = population?.metrics.find((x) => x.id === "sexRatio");
    expect(m).toBeDefined();
    expect(m!.minValue).toBe(0);
    expect(m!.maxValue).toBe(100);
  });

  it("surfaces dependencyRatio under the population category", () => {
    expect(population?.metrics.some((x) => x.id === "dependencyRatio")).toBe(true);
  });

  it("sexRatio description carries no specific years and no 'current rate' (house rule)", () => {
    const m = population!.metrics.find((x) => x.id === "sexRatio")!;
    const text = `${m.description} ${m.detailedDescription ?? ""}`;
    expect(/\b(19|20)\d{2}\b/.test(text)).toBe(false);
    expect(/current rate/i.test(text)).toBe(false);
  });
});
