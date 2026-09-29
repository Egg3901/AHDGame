import { describe, expect, it } from "vitest";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { undergroundRaidFine, unionEnforcementDelegatePosition } from "./enforcementAuthority";

describe("union ban enforcement delegation", () => {
  it("selects one existing domestic enforcement seat for every configured country", () => {
    for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
      expect(unionEnforcementDelegatePosition(countryId), countryId).not.toBeNull();
    }
    expect(unionEnforcementDelegatePosition("US")).toBe("director_of_intelligence");
    expect(unionEnforcementDelegatePosition("DE")).toBe("labour_minister");
    expect(unionEnforcementDelegatePosition("IE")).toBe("minister_for_justice");
    expect(unionEnforcementDelegatePosition("JP")).toBe("internal_affairs_minister");
  });

  it("takes ten percent of available frozen cash without creating a negative balance", () => {
    expect(undergroundRaidFine(100)).toBe(10);
    expect(undergroundRaidFine(9)).toBe(0);
    expect(undergroundRaidFine(0)).toBe(0);
    expect(undergroundRaidFine(-5)).toBe(0);
    expect(undergroundRaidFine(Number.NaN)).toBe(0);
  });
});
