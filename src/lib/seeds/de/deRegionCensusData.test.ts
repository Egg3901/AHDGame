import { describe, it, expect } from "vitest";
import { deRegionCensusData } from "./deRegionCensusData";
import { deRegions } from "./deRegions";

describe("deRegionCensusData", () => {
  it("has one profile per Bundesland", () => {
    const dataKeys = new Set(Object.keys(deRegionCensusData));
    const regionKeys = new Set(deRegions.map((r) => r._id));
    expect(dataKeys).toEqual(regionKeys);
  });

  it("every sub-category sums to 100 per Land", () => {
    for (const [landId, profile] of Object.entries(deRegionCensusData)) {
      const ethnicity =
        profile.ethnicity.german +
        profile.ethnicity.turkish_russian_diaspora +
        profile.ethnicity.mena +
        profile.ethnicity.eu_southern_eastern +
        profile.ethnicity.other;
      expect(ethnicity, `${landId} ethnicity sum`).toBe(100);

      const age = profile.age.young + profile.age.mid + profile.age.mature + profile.age.senior;
      expect(age, `${landId} age sum`).toBe(100);

      const education =
        profile.education.no_degree +
        profile.education.berufsausbildung +
        profile.education.abitur +
        profile.education.hochschulabschluss;
      expect(education, `${landId} education sum`).toBe(100);

      const income = profile.income.low + profile.income.middle + profile.income.high;
      expect(income, `${landId} income sum`).toBe(100);

      const urbanization =
        profile.urbanization.urban + profile.urbanization.suburban + profile.urbanization.rural;
      expect(urbanization, `${landId} urbanization sum`).toBe(100);
    }
  });

  it("city-states Berlin + Hamburg + Bremen are ≥95% urban", () => {
    expect(deRegionCensusData.BE.urbanization.urban).toBeGreaterThanOrEqual(95);
    expect(deRegionCensusData.HH.urbanization.urban).toBeGreaterThanOrEqual(95);
    expect(deRegionCensusData.BRE.urbanization.urban).toBeGreaterThanOrEqual(95);
  });

  it("eastern Bundesländer skew older (senior share ≥27%)", () => {
    for (const landId of ["BB", "MV", "SN", "ST", "TH"]) {
      expect(
        deRegionCensusData[landId].age.senior,
        `${landId} senior share`
      ).toBeGreaterThanOrEqual(27);
    }
  });

  it("eastern Bundesländer have low ethnic-minority share (<10% non-German combined)", () => {
    for (const landId of ["BB", "MV", "SN", "ST", "TH"]) {
      const nonGerman = 100 - deRegionCensusData[landId].ethnicity.german;
      expect(nonGerman, `${landId} non-German share`).toBeLessThan(10);
    }
  });
});
