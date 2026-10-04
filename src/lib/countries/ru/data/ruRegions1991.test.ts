import { describe, expect, it } from "vitest";
import { RU_1991_POPULATION } from "./ruPopulation1991";
import { ruRegions1991 } from "./ruRegions1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";

describe("Russia 1991 regions", () => {
  it("covers the RSFSR alone and preserves the national population and GDP", () => {
    expect(ruRegions1991).toHaveLength(10);
    expect(ruRegions1991.map((region) => region._id)).not.toContain("KAZ");
    expect(ruRegions1991.reduce((sum, region) => sum + region.population, 0)).toBe(
      RU_1991_POPULATION
    );
    expect(ruRegions1991.reduce((sum, region) => sum + region.gdp, 0)).toBeCloseTo(
      SUCCESSOR_NOMINAL_GDP_1991.RU / 1_000_000,
      5
    );
    expect(ruRegions1991.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(1_068);
  });
});
