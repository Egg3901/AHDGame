import { describe, expect, it } from "vitest";
import { ddStateMetrics1953 } from "./ddStateMetrics1953";

describe("1953 GDR regional macro texture", () => {
  it("varies labor friction, poverty, and fertility without moving the national baseline", () => {
    const values = (path: "unemploymentRate" | "povertyRate") =>
      ddStateMetrics1953.map((row) => row.economic[path].value);
    // `birthRate` is optional on StateMetrics, so assert every DD row carries
    // one rather than asserting it away: a row that lost its fertility metric
    // should fail this test, not read as 0.
    const birthRates = ddStateMetrics1953.map((row) => {
      const birthRate = row.population.birthRate;
      expect(birthRate, "every DD 1953 row must define population.birthRate").toBeDefined();
      return birthRate!.value;
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
