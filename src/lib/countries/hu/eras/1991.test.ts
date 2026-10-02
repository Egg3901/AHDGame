import { describe, expect, it } from "vitest";
import { getCountryConfig } from "@/lib/constants/countries";
import { getParliamentaryCountryIds } from "@/lib/turn/parliamentaryGovernment";
import { huRegions1991 } from "../data/huRegions1991";

describe("HU 1991 successor institutions", () => {
  it("matches the 386-seat regional roster and enters the parliamentary turn phase", () => {
    const config = getCountryConfig("HU", "1991-default");
    expect(config.governmentType).toBe("parliamentaryRepublic");
    expect(config.legislature.lowerChamber.seats).toBe(386);
    expect(config.coalitionThreshold).toBe(194);
    expect(config.headOfStateSelection).toBe("legislatureAppointment");
    expect(config.electionSystems.lowerChamber).toBe("ams");
    expect(config.officeTypes.some((office) => office.key === "generalSecretary")).toBe(false);
    expect(huRegions1991.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(386);
    expect(getParliamentaryCountryIds("1991-default")).toContain("HU");
  });

  it("keeps the Cold War state and the authored 2027 parliament distinct", () => {
    expect(getCountryConfig("HU", "1979-default").governmentType).toBe("onePartyState");
    expect(getCountryConfig("HU", "2027-default").legislature.lowerChamber.seats).toBe(199);
  });
});
