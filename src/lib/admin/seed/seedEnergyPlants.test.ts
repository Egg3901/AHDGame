import { describe, it, expect } from "vitest";
import { buildCountryFleet } from "./seedEnergyPlants";
import { getEnergySource } from "@/lib/constants/cabinetEnergy";

describe("buildCountryFleet", () => {
  it("is deterministic for the same inputs", () => {
    const a = buildCountryFleet("US", "secretary_of_energy", ["US-CA", "US-TX"], 1);
    const b = buildCountryFleet("US", "secretary_of_energy", ["US-CA", "US-TX"], 1);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
  it("seeds valid sources sited in the given regions", () => {
    const fleet = buildCountryFleet("US", "secretary_of_energy", ["US-CA", "US-TX"], 1);
    for (const p of fleet) {
      expect(getEnergySource(p.source)).toBeDefined();
      expect(["US-CA", "US-TX"]).toContain(p.regionId);
      expect(p.tier).toBeGreaterThanOrEqual(0);
      expect(p.tier).toBeLessThanOrEqual(1);
      expect(p.positionId).toBe("secretary_of_energy");
      expect(p.capacityBase).toBeGreaterThan(0);
    }
  });
  it("returns [] when no regions", () => {
    expect(buildCountryFleet("US", "secretary_of_energy", [], 1)).toEqual([]);
  });
});
