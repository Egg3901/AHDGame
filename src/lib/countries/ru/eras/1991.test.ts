import { describe, expect, it } from "vitest";
import { getCountryConfig } from "@/lib/constants/countries";
import { getParliamentaryCountryIds } from "@/lib/turn/parliamentaryGovernment";
import { ruRegions1991 } from "../data/ruRegions1991";

describe("Russian 1991 transitional institutions", () => {
  it("models the elected RSFSR Congress rather than the USSR Supreme Soviet", () => {
    const config = getCountryConfig("RU", "1991-default");
    expect(config.governmentType).toBe("parliamentaryRepublic");
    expect(config.rulingPartyId).toBeUndefined();
    expect(config.legislature.name).toBe("Congress of People's Deputies");
    expect(config.legislature.bicameral).toBe(false);
    expect(config.legislature.lowerChamber).toMatchObject({
      key: "congressOfPeoplesDeputies",
      seats: 1_068,
      elected: true,
    });
    expect(config.legislature.upperChamber).toBeUndefined();
    expect(config.headOfStateTitle).toBe("Chairman of the Supreme Soviet");
    expect(config.officeTypes.map((office) => office.key)).toEqual([
      "primeMinister",
      "chairmanOfSupremeSoviet",
      "congressDeputy",
    ]);
    expect(ruRegions1991.reduce((total, region) => total + region.houseDistricts, 0)).toBe(1_068);
    expect(ruRegions1991.every((region) => region.stateSenateSeats === 0)).toBe(true);
    expect(getParliamentaryCountryIds("1991-default")).toContain("RU");
  });

  it("preserves Cold War Soviet and 2027 federal institutions", () => {
    expect(getCountryConfig("RU", "1979-default").governmentType).toBe("onePartyState");
    expect(getCountryConfig("RU", "1979-default").legislature.bicameral).toBe(true);
    expect(getCountryConfig("RU", "2027-default").legislature.lowerChamber.key).toBe("stateDuma");
  });
});
