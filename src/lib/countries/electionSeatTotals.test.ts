import { describe, expect, it } from "vitest";
import { getCountryConfig } from "@/lib/constants/countries";
import { frRegions1953 } from "@/lib/countries/fr/data/frRegions1953";
import { frRegions } from "@/lib/countries/fr/data/frRegions";
import { ngRegions1953 } from "@/lib/countries/ng/data/ngRegions1953";

function upperChamberSeats(regions: Array<{ stateSenateSeats?: number }>): number {
  return regions.reduce((total, region) => total + (region.stateSenateSeats ?? 0), 0);
}

describe("regional upper-chamber apportionment", () => {
  it("matches France's 1953 Council of the Republic size", () => {
    expect(upperChamberSeats(frRegions1953)).toBe(
      getCountryConfig("FR", "1953-default").legislature.upperChamber?.seats
    );
  });

  it("matches France's modern Senate size", () => {
    expect(upperChamberSeats(frRegions)).toBe(
      getCountryConfig("FR", "2019-default").legislature.upperChamber?.seats
    );
  });

  it("matches Nigeria's 1953 Senate size", () => {
    expect(upperChamberSeats(ngRegions1953)).toBe(
      getCountryConfig("NG", "1953-default").legislature.upperChamber?.seats
    );
  });
});
