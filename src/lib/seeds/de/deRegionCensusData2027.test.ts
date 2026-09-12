import { describe, it, expect } from "vitest";
import { deRegionCensusData2027 } from "./deRegionCensusData2027";
import { deRegionCensusData2023 } from "./deRegionCensusData2023";
import { deRegions2027 } from "./deRegions2027";

describe("deRegionCensusData2027", () => {
  it("has one profile per Bundesland", () => {
    const dataKeys = new Set(Object.keys(deRegionCensusData2027));
    const regionKeys = new Set(deRegions2027.map((r) => String(r._id)));
    expect(dataKeys).toEqual(regionKeys);
  });

  it("every sub-category sums to 100 per Land", () => {
    for (const [landId, profile] of Object.entries(deRegionCensusData2027)) {
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

  it("city-states Berlin + Hamburg + Bremen are 95%+ urban", () => {
    expect(deRegionCensusData2027.BE.urbanization.urban).toBeGreaterThanOrEqual(95);
    expect(deRegionCensusData2027.HH.urbanization.urban).toBeGreaterThanOrEqual(95);
    expect(deRegionCensusData2027.BRE.urbanization.urban).toBeGreaterThanOrEqual(95);
  });

  it("eastern Bundesländer skew older (senior share 30%+ outside Berlin)", () => {
    for (const landId of ["BB", "MV", "SN", "ST", "TH"]) {
      expect(
        deRegionCensusData2027[landId].age.senior,
        `${landId} senior share`
      ).toBeGreaterThanOrEqual(30);
    }
  });

  it("is a small drift from 2023, not a rewrite (each key within 3 points)", () => {
    const dims = ["ethnicity", "age", "education", "income", "urbanization"] as const;
    for (const [landId, profile] of Object.entries(deRegionCensusData2027)) {
      const prev = deRegionCensusData2023[landId];
      for (const dim of dims) {
        for (const [key, value] of Object.entries(profile[dim])) {
          const before = (prev[dim] as Record<string, number>)[key];
          expect(Math.abs(value - before), `${landId} ${dim}.${key} drift`).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it("tertiary attainment rises versus 2023 in the city-states", () => {
    for (const landId of ["BE", "HH", "BRE"]) {
      expect(
        deRegionCensusData2027[landId].education.hochschulabschluss,
        `${landId} hochschulabschluss`
      ).toBeGreaterThanOrEqual(deRegionCensusData2023[landId].education.hochschulabschluss);
    }
  });
});
