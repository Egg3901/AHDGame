import { describe, expect, it } from "vitest";
import profiles from "./provisionalBalanceProfiles.json";
import { resetLawFamilies } from "./catalog";

describe("design-only reset law balance vectors", () => {
  it("covers every law family without granting legal, fiscal, or outcome approval", () => {
    expect(profiles).toHaveLength(resetLawFamilies.length);
    expect(new Set(profiles.map((profile) => profile.familyId)).size).toBe(profiles.length);
    for (const family of resetLawFamilies) {
      const profile = profiles.find((row) => row.familyId === family.id);
      expect(profile?.status).toBe("provisional-design-only");
      expect(profile?.baseCostFractionOfGdp).toBeGreaterThan(0);
      expect(profile?.allocationFactors).toHaveLength(5);
      expect(profile?.primaryResponse).toHaveLength(5);
      expect(profile?.secondaryResponseFactors).toHaveLength(5);
      expect(
        [
          profile?.baseCostFractionOfGdp ?? Number.NaN,
          ...(profile?.allocationFactors ?? []),
          ...(profile?.primaryResponse ?? []),
          ...(profile?.secondaryResponseFactors ?? []),
        ].every((value) => Number.isFinite(value) && value >= 0)
      ).toBe(true);
    }
  });

  it("does not mislabel migration or rights-access vectors as measured outcomes", () => {
    expect(profiles.find((row) => row.familyId === "L49")?.responseMeaning).toMatch(
      /not migration flow/
    );
    for (const familyId of ["L50", "L51"]) {
      expect(profiles.find((row) => row.familyId === familyId)?.responseMeaning).toMatch(
        /unscored/
      );
    }
  });
});
