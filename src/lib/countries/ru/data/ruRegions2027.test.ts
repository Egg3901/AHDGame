import { describe, expect, it } from "vitest";
import { ruRegions2027 } from "./ruRegions2027";
import { ruRegions1991 } from "./ruRegions1991";
import { ruRegions } from "./ruRegions";
import { ruStateMetrics2027 } from "./ruStateMetrics2027";
import { ruStateBaselines2027 } from "./ruStateBaselines2027";
import { RU_ALL_AGE_CENSUS_2021, RU_ADULT_CENSUS_2021 } from "./ruAdultCensus2021";

// Anchors cited in ruRegions2027: Rosstat 1 Jan 2025 usually-resident
// population and revised 2024 nominal GDP (millions of rubles).
const ROSSTAT_POPULATION_2025 = 146_119_928;
const ROSSTAT_GDP_2024_MRUB = 201_152_000;

describe("Russia 2027 regions", () => {
  it("projects the 2021 all-age macroregion distribution onto the 2025 national anchor", () => {
    expect(Object.values(RU_ALL_AGE_CENSUS_2021).reduce((sum, n) => sum + n, 0)).toBe(147_182_123);
    for (const region of ruRegions2027) {
      const id = region._id as keyof typeof RU_ALL_AGE_CENSUS_2021;
      const quota = (ROSSTAT_POPULATION_2025 * RU_ALL_AGE_CENSUS_2021[id]) / 147_182_123;
      expect(Math.abs(region.population - quota)).toBeLessThan(1);
      expect(RU_ADULT_CENSUS_2021[id].reduce((sum, n) => sum + n, 0)).toBeLessThan(
        RU_ALL_AGE_CENSUS_2021[id]
      );
    }
    expect(Object.fromEntries(ruRegions2027.map((r) => [r._id, r.population]))).toMatchObject({
      CEN: 33_036_428,
      NCA: 23_022_462,
      NOR: 4_072_249,
    });
  });

  it("keeps the ten RSFSR ids and reconciles to the Rosstat anchors", () => {
    expect(ruRegions2027).toHaveLength(10);
    expect(ruRegions2027.map((r) => r._id).sort()).toEqual(ruRegions1991.map((r) => r._id).sort());
    expect(ruRegions2027.reduce((sum, r) => sum + r.population, 0)).toBe(ROSSTAT_POPULATION_2025);
    expect(ruRegions2027.reduce((sum, r) => sum + r.gdp, 0)).toBe(ROSSTAT_GDP_2024_MRUB);
    expect(ruRegions2027.reduce((sum, r) => sum + r.houseDistricts, 0)).toBe(450);
    expect(ruRegions2027.reduce((sum, r) => sum + r.stateSenateSeats, 0)).toBe(178);
    for (const region of ruRegions2027) {
      expect(region.countryId).toBe("RU");
      expect(region.houseDistricts).toBeGreaterThan(0);
      expect(region.stateSenateSeats).toBeGreaterThan(0);
    }
  });

  it("covers every 2027 region with metrics and matching baselines", () => {
    expect(ruStateMetrics2027).toHaveLength(10);
    expect(ruStateBaselines2027).toHaveLength(10);
    const metricIds = ruStateMetrics2027.map((m) => m._id).sort();
    expect(metricIds).toEqual(ruRegions2027.map((r) => r._id).sort());
    for (const baseline of ruStateBaselines2027) {
      const metrics = ruStateMetrics2027.find((m) => m._id === baseline._id);
      expect(metrics).toBeDefined();
      expect(baseline.baselines.economic.medianIncome).toBe(metrics?.economic.medianIncome.value);
    }
  });

  it("does not disturb the Soviet or 1991 region bundles", () => {
    expect(ruRegions2027).not.toBe(ruRegions);
    expect(ruRegions2027).not.toBe(ruRegions1991);
    expect(ruRegions1991.map((r) => r._id)).not.toContain("KAZ");
    expect(ruRegions2027.map((r) => r._id)).not.toContain("KAZ");
    expect(ruRegions.reduce((sum, r) => sum + r.houseDistricts, 0)).toBe(559);
  });
});
