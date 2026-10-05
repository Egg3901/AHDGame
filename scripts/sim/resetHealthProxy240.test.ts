import { describe, expect, it } from "vitest";
import { simulateResetHealthProxy240 } from "./resetHealthProxy240";

describe("provisional health owner 240-turn sensitivity", () => {
  it("is bounded, responds to real provider inputs, and returns after a transient shock", () => {
    const summaries = simulateResetHealthProxy240();
    expect(summaries).toHaveLength(9);
    for (const countryId of ["US", "UK", "JP"] as const) {
      const rows = summaries.filter((row) => row.countryId === countryId);
      const steady = rows.find((row) => row.scenario === "unchanged")!;
      const expansion = rows.find((row) => row.scenario === "capacity_expansion")!;
      const shock = rows.find((row) => row.scenario === "provider_shock")!;
      expect(steady.finalCoverage).toBe(steady.initialCoverage);
      expect(steady.finalDelay).toBe(steady.initialDelay);
      expect(expansion.finalCoverage).toBeGreaterThanOrEqual(steady.finalCoverage);
      expect(expansion.finalDelay).toBeLessThan(steady.finalDelay);
      expect(shock.lowestCoverage).toBeLessThan(steady.initialCoverage);
      expect(shock.highestDelay).toBeGreaterThan(steady.initialDelay);
      expect(shock.finalCoverage).toBe(steady.finalCoverage);
      expect(shock.finalDelay).toBe(steady.finalDelay);
      expect(rows.every((row) => row.lowestCoverage >= 0 && row.highestDelay <= 60)).toBe(true);
    }
  });
});
