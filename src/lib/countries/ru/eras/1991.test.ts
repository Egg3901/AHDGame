import { describe, expect, it } from "vitest";
import { getCountryConfig } from "@/lib/constants/countries";
import { getParliamentaryCountryIds } from "@/lib/turn/parliamentaryGovernment";
import { ruRegions1991 } from "../data/ruRegions1991";
import { sovietUnionRegions1991 } from "../data/sovietUnionRegions1991";
import { ru1991PresidencyStage, ru1993LegislatureStage } from "./1991";
import { getCountryConfigForRuntime } from "@/lib/constants/countries";

describe("Russian 1991 transitional institutions", () => {
  it("opens with the 2,250-member Soviet Union Congress", () => {
    const config = getCountryConfig("RU", "1991-default");
    expect(config.governmentType).toBe("parliamentaryRepublic");
    expect(config.rulingPartyId).toBeUndefined();
    expect(config.name).toBe("Soviet Union");
    expect(config.legislature.name).toBe("Congress of People's Deputies of the Soviet Union");
    expect(config.legislature.bicameral).toBe(false);
    expect(config.legislature.lowerChamber).toMatchObject({
      key: "unionCongress",
      seats: 2_250,
      elected: true,
    });
    expect(config.legislature.upperChamber).toBeUndefined();
    expect(config.headOfStateTitle).toBe("President of the Soviet Union");
    expect(config.officeTypes.map((office) => office.key)).toEqual([
      "chairmanOfCabinet",
      "sovietPresident",
      "unionCongressDeputy",
    ]);
    expect(sovietUnionRegions1991).toHaveLength(24);
    expect(sovietUnionRegions1991.reduce((total, region) => total + region.houseDistricts, 0)).toBe(
      2_250
    );
    expect(ruRegions1991.reduce((total, region) => total + region.houseDistricts, 0)).toBe(1_068);
    expect(ruRegions1991.every((region) => region.stateSenateSeats === 0)).toBe(true);
    expect(getParliamentaryCountryIds("1991-default")).toContain("RU");
  });

  it("preserves Cold War Soviet and 2027 federal institutions", () => {
    expect(getCountryConfig("RU", "1979-default").governmentType).toBe("onePartyState");
    expect(getCountryConfig("RU", "1979-default").legislature.bicameral).toBe(true);
    expect(getCountryConfig("RU", "2027-default").legislature.lowerChamber.key).toBe("stateDuma");
  });

  it("distinguishes the June election from the July inauguration", () => {
    expect(ru1991PresidencyStage(1)).toBe("chairman");
    expect(ru1991PresidencyStage(20)).toBe("chairman");
    expect(ru1991PresidencyStage(21)).toBe("elected");
    expect(ru1991PresidencyStage(24)).toBe("elected");
    expect(ru1991PresidencyStage(25)).toBe("inaugurated");
    expect(ru1991PresidencyStage(48)).toBe("inaugurated");
  });

  it("selects the presidential office only after the runtime marker", () => {
    const initial = getCountryConfigForRuntime("RU", "1991-default", null);
    const successor = getCountryConfigForRuntime("RU", "1991-default", {
      ruSovietSuccessionSinceTurn: 24,
    });
    const elected = getCountryConfigForRuntime("RU", "1991-default", {
      ruPresidencySinceTurn: 25,
    });
    expect(initial.headOfStateTitle).toBe("President of the Soviet Union");
    expect(successor.name).toBe("Russia");
    expect(successor.headOfStateTitle).toBe("Chairman of the Supreme Soviet");
    expect(successor.legislature.lowerChamber.seats).toBe(1_068);
    expect(elected.headOfStateTitle).toBe("President");
    expect(elected.headOfStateSelection).toBeUndefined();
    expect(elected.officeTypes.find((office) => office.isHeadOfState)?.key).toBe("president");
    expect(elected.legislature.lowerChamber.seats).toBe(1_068);
    expect(elected.officeTypes.some((office) => office.key === "primeMinister")).toBe(true);
    expect(getCountryConfigForRuntime("RU", "1979-default", { ruPresidencySinceTurn: 25 })).toEqual(
      getCountryConfig("RU", "1979-default")
    );
    expect(getCountryConfigForRuntime("RU", "2027-default", { ruPresidencySinceTurn: 25 })).toEqual(
      getCountryConfig("RU", "2027-default")
    );
  });

  it("retires Congress in September, elects in December, and convenes in January", () => {
    expect(ru1993LegislatureStage(128)).toBe("congress");
    expect(ru1993LegislatureStage(129)).toBe("dissolved");
    expect(ru1993LegislatureStage(140)).toBe("dissolved");
    expect(ru1993LegislatureStage(141)).toBe("elected");
    expect(ru1993LegislatureStage(145)).toBe("federalAssembly");
    const dissolved = getCountryConfigForRuntime("RU", "1991-default", {
      ruCongressDissolvedSinceTurn: 129,
    });
    expect(dissolved.legislature.lowerChamber.seats).toBe(0);
    expect(dissolved.officeTypes.some((office) => office.key === "congressDeputy")).toBe(false);
    const assembly = getCountryConfigForRuntime("RU", "1991-default", {
      ruCongressDissolvedSinceTurn: 129,
      ruFederalAssemblySinceTurn: 141,
    });
    expect(assembly.legislature.name).toBe("Federal Assembly");
    expect(assembly.legislature.lowerChamber).toMatchObject({ key: "stateDuma", seats: 450 });
    expect(assembly.legislature.upperChamber).toMatchObject({
      key: "federationCouncil",
      seats: 178,
      elected: true,
    });
    expect(assembly.lowerElectionSystem.termYears).toBe(2);
    expect(assembly.upperElectionSystem?.termYears).toBe(2);
    expect(assembly.officeTypes.map((office) => office.key)).toContain("dumaDeputy");
    expect(assembly.officeTypes.map((office) => office.key)).toContain("federationCouncilMember");
    expect(assembly.headOfStateTitle).toBe("President");
    expect(getCountryConfig("RU", "1979-default").legislature.name).not.toBe("Federal Assembly");
    expect(getCountryConfig("RU", "2027-default").lowerElectionSystem.termYears).toBe(5);
  });
});
