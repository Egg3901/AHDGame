import { describe, expect, it } from "vitest";
import { getCountryConfig } from "@/lib/constants/countries";
import { RO_GEOGRAPHY } from "../geography";
import { RO_2027 } from "./2027";
import { roRegions2027 } from "../data/roRegions2027";

describe("RO 2027 government and geography", () => {
  it("authors a democratic override for the modern preset", () => {
    expect(RO_2027.preset).toBe("2027-default");
    const config = RO_2027.config;
    expect(config?.governmentType).toBe("presidential");
    expect(config?.governmentTypeLabel).toBe("Semi-Presidential Republic");
    expect(config?.rulingPartyId).toBeUndefined();
    expect(config?.headOfStateSelection).toBeUndefined();
    expect(config?.legislature?.bicameral).toBe(true);
    expect(config?.legislature?.lowerChamber.seats).toBe(331);
    expect(config?.legislature?.upperChamber?.seats).toBe(134);
    expect(config?.coalitionThreshold).toBe(233);
    expect(config?.executiveTitle).toBe("Prime Minister");
    expect(config?.headOfStateTitle).toBe("President");
    expect(config?.exchangeKind).toBe("market");
    expect(config?.centralGovernmentLabel).toBe("National Government");
    expect(config?.usdExchangeRate).toBeCloseTo(0.2166, 12);
    expect(getCountryConfig("RO", "2027-default").governmentType).toBe("presidential");
    expect(getCountryConfig("RO", "2027-default").legislature.lowerChamber.seats).toBe(331);
    expect(RO_GEOGRAPHY.regionBundles["2027-default"]).toBe(roRegions2027);
  });

  it("keeps the Cold War presets on their one-party institutions and regions", () => {
    for (const preset of ["1953-default", "1979-default"] as const) {
      const config = getCountryConfig("RO", preset);
      expect(config.governmentType).toBe("onePartyState");
      expect(config.legislature.lowerChamber.seats).toBe(369);
      expect(config.exchangeKind).toBe("stateRegister");
      expect(RO_GEOGRAPHY.regionBundles[preset]).not.toBe(roRegions2027);
    }
  });

  it("keeps the 1991 preset on its inherited configuration", () => {
    const config = getCountryConfig("RO", "1991-default");
    expect(config.governmentType).toBe("onePartyState");
    expect(config.legislature.lowerChamber.seats).toBe(369);
    expect(config.exchangeKind).toBe("stateRegister");
  });
});
