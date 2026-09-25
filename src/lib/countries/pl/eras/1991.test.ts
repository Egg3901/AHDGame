import { describe, expect, it } from "vitest";
import { getCountryConfig } from "@/lib/constants/countries";

describe("Poland 1991 institutions", () => {
  it("uses the restored bicameral parliamentary republic", () => {
    const country = getCountryConfig("PL", "1991-default");
    expect(country.governmentType).toBe("parliamentaryRepublic");
    expect(country.headOfStateSelection).toBeUndefined();
    expect(country.rulingPartyId).toBeUndefined();
    expect(country.legislature.bicameral).toBe(true);
    expect(country.legislature.lowerChamber.seats).toBe(460);
    expect(country.legislature.upperChamber?.seats).toBe(100);
    expect(country.electionSystems.lowerChamber).toBe("pr_hareQuota");
  });

  it("keeps the 1979 one-party institutions in their own era", () => {
    const country = getCountryConfig("PL", "1979-default");
    expect(country.governmentType).toBe("onePartyState");
    expect(country.legislature.bicameral).toBe(false);
  });
});
