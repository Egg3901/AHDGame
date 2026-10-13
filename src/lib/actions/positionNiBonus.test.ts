import { describe, expect, it } from "vitest";
import { resolveLeadershipActionBonus, resolvePositionNiBonus } from "./positionNiBonus";

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

  it("grants the cabinet tier from membership without currentOffice", () => {
    expect(resolvePositionNiBonus({ countryId: "US", cabinetCountryId: "US" })).toBe(1.5);
  });

  it("grants an acting cabinet member the acting tier, even with the cabinet key as office", () => {
    expect(
      resolvePositionNiBonus({
        countryId: "US",
        currentOfficeType: "usCabinet",
        cabinetCountryId: "US",
        isActingCabinet: true,
      })
    ).toBe(0.75);
  });

  it("grants CEO tiers below any office", () => {
    expect(resolvePositionNiBonus({ countryId: "US", ceoTier: "major" })).toBe(0.3);
    expect(resolvePositionNiBonus({ countryId: "US", ceoTier: "standard" })).toBe(0.15);
    expect(
      resolvePositionNiBonus({ countryId: "US", currentOfficeType: "house", ceoTier: "major" })
    ).toBe(1);
  });

  it("adds international leadership on top of the domestic tier", () => {
    expect(
      resolvePositionNiBonus({
        countryId: "UK",
        currentOfficeType: "primeMinister",
        isOrgHead: true,
      })
    ).toBe(3.5);
  });

  it("grants presiding officers outside the US the presiding tier", () => {
    expect(
      resolvePositionNiBonus({
        countryId: "DE",
        currentOfficeType: "bundestag",
        congressLeadershipRoles: ["speaker_of_the_bundestag"],
      })
    ).toBe(2);
  });
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

describe("resolveLeadershipActionBonus", () => {
  it("tiers chamber leadership and takes the highest role", () => {
    expect(
      resolveLeadershipActionBonus({ congressLeadershipRoles: ["speaker_of_the_house"] })
    ).toBe(3);
    expect(
      resolveLeadershipActionBonus({ congressLeadershipRoles: ["minority_leader_senate"] })
    ).toBe(2);
    expect(
      resolveLeadershipActionBonus({ congressLeadershipRoles: ["president_pro_tempore"] })
    ).toBe(1);
    expect(
      resolveLeadershipActionBonus({
        congressLeadershipRoles: ["majority_whip_house", "majority_leader_house"],
      })
    ).toBe(2);
    expect(resolveLeadershipActionBonus({ isOppositionLeader: true })).toBe(2);
    expect(resolveLeadershipActionBonus({ isShadowCabinetMember: true })).toBe(1);
    expect(resolveLeadershipActionBonus({})).toBe(0);
  });
});
