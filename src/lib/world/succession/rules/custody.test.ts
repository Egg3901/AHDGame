import { describe, expect, it } from "vitest";
import { planSuccessionCustody } from "./custody";

const territories = [
  { entityId: "RU", regionIds: ["CEN"], population: 1, annualGdpAnchor: 1 },
  { entityId: "UKR", regionIds: ["SU_UKR"], population: 1, annualGdpAnchor: 1 },
];

describe("federation physical custody", () => {
  it("follows territory for local assets without creating detailed background offices", () => {
    const plan = planSuccessionCustody({
      sourceEntityId: "RU",
      territories,
      assets: [
        { assetId: "factory-r", kind: "public-enterprise", homeRegionId: "CEN", valueMinor: 9 },
        {
          assetId: "factory-u",
          kind: "public-enterprise",
          homeRegionId: "SU_UKR",
          valueMinor: 7,
        },
        {
          assetId: "army-u",
          kind: "conventional-force",
          homeRegionId: "SU_UKR",
          valueMinor: 3,
        },
        {
          assetId: "strategic-u",
          kind: "strategic-force",
          homeRegionId: "SU_UKR",
          valueMinor: 5,
        },
      ],
      strategicCustodians: { "strategic-u": "RU" },
    });
    expect(plan.map((row) => [row.assetId, row.custodianEntityId, row.disposition])).toEqual([
      ["factory-r", "RU", "retain-detailed"],
      ["factory-u", "UKR", "aggregate-background"],
      ["army-u", "UKR", "aggregate-background"],
      ["strategic-u", "RU", "retain-detailed"],
    ]);
    expect(plan.reduce((sum, row) => sum + row.valueMinor, 0)).toBe(24);
  });

  it("refuses silent strategic assignment, unknown regions and duplicate assets", () => {
    const strategic = {
      assetId: "strategic-u",
      kind: "strategic-force" as const,
      homeRegionId: "SU_UKR",
      valueMinor: 5,
    };
    const input = { sourceEntityId: "RU", territories, assets: [strategic] };
    expect(() => planSuccessionCustody(input)).toThrow("Strategic custody requires");
    expect(() =>
      planSuccessionCustody({ ...input, strategicCustodians: { "strategic-u": "EE" } })
    ).toThrow("Strategic custody requires");
    expect(() =>
      planSuccessionCustody({
        ...input,
        assets: [{ ...strategic, kind: "public-enterprise", homeRegionId: "XX" }],
      })
    ).toThrow("outside source territory");
    expect(() =>
      planSuccessionCustody({
        ...input,
        assets: [strategic, strategic],
        strategicCustodians: { "strategic-u": "RU" },
      })
    ).toThrow("duplicated");
  });
});
