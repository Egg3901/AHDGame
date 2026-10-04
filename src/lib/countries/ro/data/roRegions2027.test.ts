import { describe, expect, it } from "vitest";
import { roRegions2027 } from "./roRegions2027";
import { roRegions } from "./roRegions";
import { roStateMetrics2027 } from "./roStateMetrics2027";
import { roStateBaselines2027 } from "./roStateBaselines2027";

// INSSE anchors cited in roRegions2027: 1 Jan 2025 usually resident
// population and 2024 annual GDP (millions of lei).
const INSSE_POPULATION_2025 = 19_043_151;
const INSSE_GDP_2024_MLEI = 1_766_068;

describe("Romania 2027 regions", () => {
  it("keeps the seven historic-province ids and reconciles to the INSSE anchors", () => {
    expect(roRegions2027).toHaveLength(7);
    expect(roRegions2027.map((r) => r._id).sort()).toEqual(roRegions.map((r) => r._id).sort());
    expect(roRegions2027.reduce((sum, r) => sum + r.population, 0)).toBe(INSSE_POPULATION_2025);
    expect(roRegions2027.reduce((sum, r) => sum + r.gdp, 0)).toBe(INSSE_GDP_2024_MLEI);
    expect(roRegions2027.reduce((sum, r) => sum + r.houseDistricts, 0)).toBe(331);
    expect(roRegions2027.reduce((sum, r) => sum + r.stateSenateSeats, 0)).toBe(134);
    for (const region of roRegions2027) {
      expect(region.countryId).toBe("RO");
      expect(region.houseDistricts).toBeGreaterThan(0);
      expect(region.stateSenateSeats).toBeGreaterThan(0);
    }
  });

  it("covers every 2027 region with metrics and matching baselines", () => {
    expect(roStateMetrics2027).toHaveLength(7);
    expect(roStateBaselines2027).toHaveLength(7);
    const metricIds = roStateMetrics2027.map((m) => m._id).sort();
    expect(metricIds).toEqual(roRegions2027.map((r) => r._id).sort());
    for (const baseline of roStateBaselines2027) {
      const metrics = roStateMetrics2027.find((m) => m._id === baseline._id);
      expect(metrics).toBeDefined();
      expect(baseline.baselines.economic.medianIncome).toBe(metrics?.economic.medianIncome.value);
    }
  });

  it("does not disturb the Cold War region bundles", () => {
    expect(roRegions.reduce((sum, r) => sum + r.population, 0)).toBe(22_000_000);
    expect(roRegions2027).not.toBe(roRegions);
  });
});
