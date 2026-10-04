import { describe, expect, it } from "vitest";
import { getCountryConfig } from "@/lib/constants/countries";
import { yuRegions1991 } from "../data/yuRegions1991";
import { canonicalTurnsForCycle } from "@/lib/elections/canonicalCycle";

describe("Yugoslavia 1991 institutions", () => {
  it("uses the 1974 federal chamber and council allocations at scenario start", () => {
    const config = getCountryConfig("YU", "1991-default");
    expect(config.governmentType).toBe("parliamentaryRepublic");
    expect(config.rulingPartyId).toBeUndefined();
    expect(config.headOfStateSelection).toBeUndefined();
    expect(config.coalitionThreshold).toBe(111);
    expect(config.legislature.bicameral).toBe(true);
    expect(config.legislature.lowerChamber).toMatchObject({ key: "federalAssembly", seats: 220 });
    expect(config.legislature.upperChamber).toMatchObject({
      key: "councilRepublicsProvinces",
      seats: 88,
    });
    expect(yuRegions1991.reduce((sum, region) => sum + (region.houseDistricts ?? 0), 0)).toBe(220);
    expect(yuRegions1991.reduce((sum, region) => sum + (region.stateSenateSeats ?? 0), 0)).toBe(88);
    expect(config.officeTypes.some((office) => office.key === "primeMinister")).toBe(true);
    expect(
      config.officeTypes.some((office) => office.chamberKey === "councilRepublicsProvinces")
    ).toBe(true);
  });

  it("leaves Cold War and later presets on their separate configurations", () => {
    for (const preset of ["1953-default", "1979-default", "1999-default", "2027-default"]) {
      const config = getCountryConfig("YU", preset);
      expect(config.governmentType).toBe("onePartyState");
      expect(config.legislature.bicameral).toBe(false);
      expect(config.legislature.lowerChamber.seats).toBe(308);
    }
  });

  it("does not fabricate a 1991 federal popular election", () => {
    expect(
      canonicalTurnsForCycle({
        countryId: "YU",
        electionType: "federalAssembly",
        cycle: 1,
        ctx: { preset: "1991-default", startingYear: 1991 },
      })
    ).toBeNull();
  });
});
