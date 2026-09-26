import { describe, expect, it } from "vitest";
import { getCountryConfig } from "@/lib/constants/countries";
import { RU_GEOGRAPHY } from "../geography";
import { RU_2027 } from "./2027";
import { ruRegions2027 } from "../data/ruRegions2027";

describe("RU 2027 government and geography", () => {
  it("authors a presidential-federation override for the modern preset", () => {
    expect(RU_2027.preset).toBe("2027-default");
    const config = RU_2027.config;
    expect(config?.governmentType).toBe("presidential");
    expect(config?.governmentTypeLabel).toBe("Presidential Federation");
    expect(config?.rulingPartyId).toBeUndefined();
    expect(config?.headOfStateSelection).toBeUndefined();
    expect(config?.legislature?.bicameral).toBe(true);
    expect(config?.legislature?.lowerChamber.seats).toBe(450);
    expect(config?.legislature?.lowerChamber.elected).toBe(true);
    expect(config?.legislature?.upperChamber?.seats).toBe(178);
    expect(config?.legislature?.upperChamber?.elected).toBe(false);
    expect(config?.coalitionThreshold).toBe(226);
    expect(config?.executiveTitle).toBe("President");
    expect(config?.headOfStateTitle).toBe("President");
    expect(config?.electionSystems?.headOfState).toBe("fptp");
    expect(config?.majorPartyIds).toEqual(["er", "kprf", "ldpr", "srzp", "np"]);
    expect(config?.exchangeKind).toBe("market");
    expect(config?.centralGovernmentLabel).toBe("Federal Government");
    expect(config?.usdExchangeRate).toBeCloseTo(0.01081, 5);
    expect(getCountryConfig("RU", "2027-default").governmentType).toBe("presidential");
    expect(getCountryConfig("RU", "2027-default").legislature.lowerChamber.seats).toBe(450);
    expect(RU_GEOGRAPHY.regionBundles["2027-default"]).toBe(ruRegions2027);
  });

  it("keeps the Cold War presets on their one-party institutions and regions", () => {
    const expectedSeats = { "1953-default": 526, "1979-default": 559 } as const;
    for (const preset of ["1953-default", "1979-default"] as const) {
      const config = getCountryConfig("RU", preset);
      expect(config.governmentType).toBe("onePartyState");
      expect(config.legislature.lowerChamber.seats).toBe(expectedSeats[preset]);
      expect(config.exchangeKind).toBe("stateRegister");
      expect(RU_GEOGRAPHY.regionBundles[preset]).not.toBe(ruRegions2027);
    }
  });

  it("keeps the 1991 preset on its inherited one-party configuration", () => {
    const config = getCountryConfig("RU", "1991-default");
    expect(config.governmentType).toBe("onePartyState");
    expect(config.legislature.lowerChamber.seats).toBe(559);
    expect(config.exchangeKind).toBe("stateRegister");
  });
});
