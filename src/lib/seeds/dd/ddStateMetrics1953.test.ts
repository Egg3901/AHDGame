import { describe, expect, it } from "vitest";
import { ddStateMetrics1953 } from "./ddStateMetrics1953";

describe("1953 GDR regional macro texture", () => {
  it("varies labor friction, poverty, and fertility without moving the national baseline", () => {
    const values = (path: "unemploymentRate" | "povertyRate") =>
      ddStateMetrics1953.map((row) => row.economic[path].value);
    // birthRate is optional on the metric shape. Every 1953 DD row is expected
    // to carry one, so assert that rather than papering over a missing row with
    // a default that would quietly weaken the variance check below.
    const birthRates = ddStateMetrics1953.map((row) => {
      const birthRate = row.population.birthRate;
      if (!birthRate) throw new Error("every DD 1953 state row must carry a birthRate");
      return birthRate.value;
    });
    const mean = (rows: number[]) => rows.reduce((sum, value) => sum + value, 0) / rows.length;

    expect(new Set(values("unemploymentRate")).size).toBeGreaterThan(1);
    expect(new Set(values("povertyRate")).size).toBeGreaterThan(1);
    expect(new Set(birthRates).size).toBeGreaterThan(1);
    expect(mean(values("unemploymentRate"))).toBeCloseTo(0.5, 0);
    expect(mean(values("povertyRate"))).toBeCloseTo(22, 0);
    expect(mean(birthRates)).toBeCloseTo(64, 0);
  });
});
