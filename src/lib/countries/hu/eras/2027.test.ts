import { describe, expect, it } from "vitest";
import { getCountryConfig } from "@/lib/constants/countries";
import { HU_GEOGRAPHY } from "../geography";
import { huRegions2027 } from "../data/huRegions2027";

describe("HU 2027 government and geography", () => {
  it("routes the modern preset to its own democratic institutions and regions", () => {
    const config = getCountryConfig("HU", "2027-default");
    expect(config.governmentType).toBe("parliamentaryRepublic");
    expect(config.rulingPartyId).toBeUndefined();
    expect(config.legislature.bicameral).toBe(false);
    expect(config.legislature.upperChamber).toBeUndefined();
    expect(config.legislature.lowerChamber.seats).toBe(199);
    expect(config.coalitionThreshold).toBe(100);
    expect(config.executiveTitle).toBe("Prime Minister");
    expect(config.headOfStateSelection).toBe("legislatureAppointment");
    expect(config.exchangeKind).toBe("market");
    expect(config.centralGovernmentLabel).toBe("National Government");
    expect(config.usdExchangeRate).toBeCloseTo(1 / 353.2, 12);
    expect(HU_GEOGRAPHY.regionBundles["2027-default"]).toBe(huRegions2027);
  });

  it("keeps the Cold War preset on its one-party institutions and regions", () => {
    for (const preset of ["1953-default", "1979-default"] as const) {
      const config = getCountryConfig("HU", preset);
      expect(config.governmentType).toBe("onePartyState");
      expect(config.legislature.lowerChamber.seats).toBe(352);
      expect(config.exchangeKind).toBe("stateRegister");
      expect(HU_GEOGRAPHY.regionBundles[preset]).not.toBe(huRegions2027);
    }
  });
});
