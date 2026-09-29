import { describe, expect, it } from "vitest";
import { resolvePositionNiBonus } from "./positionNiBonus";

describe("resolvePositionNiBonus", () => {
  it("uses the Speaker tier instead of the ordinary House tier", () => {
    expect(
      resolvePositionNiBonus({
        currentOfficeType: "house",
        countryId: "US",
        congressLeadershipRoles: ["speaker_of_the_house"],
      })
    ).toBe(2);
  });

  it("uses the highest tier when a character has multiple leadership rows", () => {
    expect(
      resolvePositionNiBonus({
        currentOfficeType: "house",
        countryId: "US",
        congressLeadershipRoles: ["speaker_of_the_house", "majority_whip_house"],
      })
    ).toBe(2);
  });

  it("grants the ordinary cabinet tier from membership without currentOffice", () => {
    expect(resolvePositionNiBonus({ countryId: "US", cabinetCountryId: "US" })).toBe(1);
  });

  it("does not stack a cabinet tier on a higher leadership tier", () => {
    expect(
      resolvePositionNiBonus({
        currentOfficeType: "house",
        countryId: "US",
        congressLeadershipRoles: ["speaker_of_the_house"],
        cabinetCountryId: "US",
      })
    ).toBe(2);
  });
});
