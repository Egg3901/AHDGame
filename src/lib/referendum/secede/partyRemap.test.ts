import { describe, it, expect } from "vitest";
import { planPartyRemap, type RegionParty } from "./partyRemap";

const ABBREV: Record<number, string> = { 20: "SNP", 21: "LAB", 22: "CON", 23: "GRN" };

describe("planPartyRemap", () => {
  it("transfers only the region-homed major; independentizes UK-wide majors and non-majors", () => {
    const regionParties: RegionParty[] = [
      { sequentialId: 20, isRegionHomed: true }, // SNP — region-homed major → transfers
      { sequentialId: 21, isRegionHomed: false }, // LAB — UK-wide major → independentized
      { sequentialId: 22, isRegionHomed: false }, // CON — non-major → independentized
      { sequentialId: 23, isRegionHomed: true }, // GRN — region-homed non-major → independentized
    ];
    const plan = planPartyRemap({
      majorPartyIds: ["SNP", "LAB"],
      regionParties,
      partyAbbrevById: ABBREV,
      nextSequentialId: 1,
    });

    expect(plan.wholesale).toEqual([20]);
    expect(plan.independentized.sort((a, b) => a - b)).toEqual([21, 22, 23]);
    expect(plan.idMap).toEqual({ 20: 1 }); // the nationalist party leads as party 1
  });

  it("matches major abbreviations case-insensitively", () => {
    const plan = planPartyRemap({
      majorPartyIds: ["snp"],
      regionParties: [{ sequentialId: 20, isRegionHomed: true }],
      partyAbbrevById: { 20: "SNP" },
      nextSequentialId: 5,
    });
    expect(plan.wholesale).toEqual([20]);
    expect(plan.idMap).toEqual({ 20: 5 });
  });

  it("independentizes a UK-wide major present in the region (no successor doc)", () => {
    const plan = planPartyRemap({
      majorPartyIds: ["SNP", "LAB"],
      regionParties: [
        { sequentialId: 20, isRegionHomed: true }, // SNP
        { sequentialId: 21, isRegionHomed: false }, // LAB — UK-wide
      ],
      partyAbbrevById: { 20: "SNP", 21: "LAB" },
      nextSequentialId: 1,
    });
    expect(plan.wholesale).toEqual([20]);
    expect(plan.independentized).toEqual([21]);
    expect(Object.keys(plan.idMap)).toEqual(["20"]);
  });
});
