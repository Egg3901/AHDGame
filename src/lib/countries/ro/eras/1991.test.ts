import { describe, expect, it } from "vitest";
import {
  getCountryConfig,
  getExecutiveOfficeKey,
  getHeadOfGovernmentOfficeKey,
} from "@/lib/constants/countries";
import { getParliamentaryCountryIds } from "@/lib/turn/parliamentaryGovernment";
import { roRegions1991 } from "../data/roRegions1991";

describe("Romania's January 1991 constituent institutions", () => {
  it("separates the directly elected president from the parliamentary prime minister", () => {
    const config = getCountryConfig("RO", "1991-default");
    expect(config.governmentType).toBe("presidential");
    expect(config.headOfStateSelection).toBeUndefined();
    expect(config.electionSystems).toMatchObject({
      lowerChamber: "pr_hareQuota",
      upperChamber: "pr_hareQuota",
      headOfGovernment: "parliamentary",
      headOfState: "fptp",
    });
    expect(getExecutiveOfficeKey("RO", "1991-default")).toBe("president");
    expect(getHeadOfGovernmentOfficeKey("RO", "1991-default")).toBe("primeMinister");
    expect(getParliamentaryCountryIds("1991-default")).toContain("RO");
  });

  it("matches the 1990 elected constituent chambers and regional apportionment", () => {
    const config = getCountryConfig("RO", "1991-default");
    expect(config.legislature.lowerChamber).toMatchObject({
      key: "chamberOfDeputies",
      seats: 396,
    });
    expect(config.legislature.upperChamber).toMatchObject({ key: "senat", seats: 119 });
    expect(config.coalitionThreshold).toBe(199);
    expect(roRegions1991.reduce((sum, region) => sum + (region.houseDistricts ?? 0), 0)).toBe(396);
    expect(roRegions1991.reduce((sum, region) => sum + (region.stateSenateSeats ?? 0), 0)).toBe(
      119
    );
  });

  it("does not rewrite the 1979 one-party or 2027 modern configuration", () => {
    expect(getCountryConfig("RO", "1979-default").governmentType).toBe("onePartyState");
    expect(getCountryConfig("RO", "1979-default").legislature.lowerChamber.seats).toBe(369);
    expect(getCountryConfig("RO", "2027-default").legislature.lowerChamber.seats).toBe(331);
    expect(getCountryConfig("RO", "2027-default").legislature.upperChamber?.seats).toBe(134);
  });
});
