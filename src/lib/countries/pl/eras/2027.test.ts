import { describe, expect, it } from "vitest";
import { getCountryConfig } from "@/lib/constants/countries";
import { PL_GEOGRAPHY } from "../geography";
import { PL_2027 } from "./2027";
import { plRegions2027 } from "../data/plRegions2027";
import { plRegions } from "../data/plRegions";
import { plRegions1953 } from "../data/plRegions1953";

describe("PL 2027 government and geography", () => {
  it("authors a democratic 2027 override in the country folder", () => {
    expect(PL_2027.preset).toBe("2027-default");
    expect(PL_2027.config?.governmentType).toBe("parliamentaryRepublic");
    expect(PL_2027.config?.rulingPartyId).toBeUndefined();
    expect(PL_2027.config?.headOfStateSelection).toBeUndefined();
    expect(PL_2027.config?.legislature?.bicameral).toBe(true);
    expect(PL_2027.config?.legislature?.lowerChamber.seats).toBe(460);
    expect(PL_2027.config?.legislature?.upperChamber?.seats).toBe(100);
    expect(PL_2027.config?.coalitionThreshold).toBe(231);
    expect(PL_2027.config?.executiveTitle).toBe("Prime Minister");
    expect(PL_2027.config?.electionSystems?.lowerChamber).toBe("pr_hareQuota");
    expect(PL_2027.config?.electionSystems?.upperChamber).toBe("fptp");
    expect(getCountryConfig("PL", "2027-default").governmentType).toBe("parliamentaryRepublic");
    expect(getCountryConfig("PL", "2027-default").legislature.upperChamber?.seats).toBe(100);
    expect(PL_GEOGRAPHY.regionBundles["2027-default"]).toBe(plRegions2027);
  });

  it("keeps the Cold War presets on one-party institutions and their own regions", () => {
    for (const preset of ["1953-default", "1979-default"] as const) {
      const config = getCountryConfig("PL", preset);
      expect(config.governmentType).toBe("onePartyState");
      expect(config.legislature.lowerChamber.seats).toBe(460);
      expect(config.legislature.bicameral).toBe(false);
      expect(PL_GEOGRAPHY.regionBundles[preset]).not.toBe(plRegions2027);
    }
    expect(PL_GEOGRAPHY.regionBundles["1953-default"]).toBe(plRegions1953);
    expect(PL_GEOGRAPHY.regionBundles["1979-default"]).toBe(plRegions);
  });

  it("leaves the 1991 democratic configuration exactly as authored", () => {
    const config = getCountryConfig("PL", "1991-default");
    expect(config.governmentType).toBe("parliamentaryRepublic");
    expect(config.legislature.lowerChamber.seats).toBe(460);
    expect(config.legislature.upperChamber?.seats).toBe(100);
    expect(config.electionSystems.lowerChamber).toBe("pr_hareQuota");
  });
});
