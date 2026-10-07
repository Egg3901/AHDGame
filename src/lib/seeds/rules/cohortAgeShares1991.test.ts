import { describe, expect, it } from "vitest";
import { cohortAgeShares1991, cohortAgeSource1991 } from "./cohortAgeShares1991";
import { COHORT_AGE_PROFILES_1991 } from "../reference/cohortAgeProfiles1991";
import {
  COHORT_AGE_SOURCES_1991,
  COHORT_REGION_SOURCE_1991,
} from "../reference/cohortAgeSources1991";

describe("1991 age-only cohort proxies", () => {
  it.each(["FR", "ES"] as const)(
    "retains dated %s national observations and adult shares",
    (country) => {
      const profile = COHORT_AGE_PROFILES_1991[country];
      expect(profile.referenceDate).toBe("1991-01-01");
      expect(Object.values(profile.adultCounts).reduce((sum, count) => sum + count, 0)).toBe(
        profile.adultPopulation
      );
      for (const region of profile.regionIds) {
        const age = cohortAgeShares1991(country, region, "1991-default")!;
        expect(Object.values(age).reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 10);
        for (const band of ["young", "mid", "mature", "senior"] as const) {
          expect(age[band]).toBeCloseTo(
            (profile.adultCounts[band] * 100) / profile.adultPopulation,
            10
          );
          expect(age[band]).toBeGreaterThan(0);
        }
      }
    }
  );
  it("does not claim other countries, unregistered regions or another era", () => {
    expect(cohortAgeShares1991("DE", "BY", "1991-default")).toBeNull();
    expect(cohortAgeShares1991("FR", "FR_UNKNOWN", "1991-default")).toBeNull();
    expect(cohortAgeShares1991("ES", "FR_IDF", "1991-default")).toBeNull();
    for (const preset of [
      "1953-default",
      "1979-default",
      "1999-default",
      "2019-default",
      "2027-default",
    ])
      expect(cohortAgeShares1991("FR", "FR_IDF", preset)).toBeNull();
  });
});

describe("1991 age-only cohort proxies for countries without a census bundle (#3369)", () => {
  const regions: Record<string, string[]> = {
    RU: [
      ...["CEN", "NWR", "NOR", "CBE", "VOL", "NCA", "URA", "WSB", "ESB", "FEA"],
      ...Object.keys(COHORT_REGION_SOURCE_1991).filter((id) => id.startsWith("SU_")),
    ],
    PL: ["PL_MAZ", "PL_LOD", "PL_MAL", "PL_SLK", "PL_DSL", "PL_WLK", "PL_POM", "PL_EAS"],
    CS: ["CS_PRG", "CS_BOH", "CS_MOR", "CS_SVK"],
    HU: ["HU_BUD", "HU_PES", "HU_TRW", "HU_TRS", "HU_NOR", "HU_ALF"],
    RO: ["RO_BUC", "RO_MUN", "RO_OLT", "RO_TRA", "RO_VST", "RO_MOL", "RO_DOB"],
    BG: ["BG_SOF", "BG_NOR", "BG_COA", "BG_THR", "BG_SW"],
    YU: ["YU_SLO", "YU_CRO", "YU_BIH", "YU_SRB", "YU_VOJ", "YU_KOS", "YU_MNE", "YU_MKD"],
    IT: ["IT_NW", "IT_NE", "IT_TUS", "IT_LAZ", "IT_CAM", "IT_SUD", "IT_SIC", "IT_SAR"],
    AT: ["AT_VIE", "AT_NOE", "AT_OOE", "AT_STK", "AT_TYR"],
    FI: ["FI_UUS", "FI_SW", "FI_HAM", "FI_EAS", "FI_OST", "FI_LAP"],
    GR: ["GR_ATT", "GR_MAC", "GR_THE", "GR_EPC", "GR_PEL", "GR_ISL"],
  };

  it("resolves a dated source for all 87 previously skipped regions", () => {
    expect(Object.values(regions).flat()).toHaveLength(87);
    expect(regions.RU).toHaveLength(24);
    for (const [country, ids] of Object.entries(regions)) {
      for (const id of ids) {
        const source = COHORT_AGE_SOURCES_1991[cohortAgeSource1991(country, id)!]!;
        expect(source, `${country}:${id}`).toBeDefined();
        expect(source.referenceDate.startsWith("1991-")).toBe(true);
        const age = cohortAgeShares1991(country, id, "1991-default")!;
        expect(Object.values(age).reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 10);
        for (const share of Object.values(age)) expect(share).toBeGreaterThan(5);
      }
    }
  });

  it("uses successor-state shapes, never the Russian shape, for union republics", () => {
    expect(cohortAgeSource1991("RU", "CEN")).toBe("WDI_RUS");
    expect(cohortAgeSource1991("RU", "SU_UZ")).toBe("WDI_UZB");
    expect(cohortAgeSource1991("CS", "CS_SVK")).toBe("EUROSTAT_SK");
    expect(cohortAgeSource1991("YU", "YU_KOS")).toBe("WDI_XKX");
    // Central Asian 1991 age structure is far younger than Russia's.
    expect(cohortAgeShares1991("RU", "SU_TJ", "1991-default")!.young).toBeGreaterThan(
      cohortAgeShares1991("RU", "CEN", "1991-default")!.young + 10
    );
  });

  it("fails closed for unregistered republics and mismatched countries", () => {
    expect(cohortAgeShares1991("RU", "SU_UNKNOWN", "1991-default")).toBeNull();
    expect(cohortAgeShares1991("YU", "YU_UNKNOWN", "1991-default")).toBeNull();
    expect(cohortAgeShares1991("PL", "SU_UKR", "1991-default")).toBeNull();
    expect(cohortAgeShares1991("RU", "CEN", "2019-default")).toBeNull();
  });

  it("keeps every source internally consistent with its published population", () => {
    for (const [key, source] of Object.entries(COHORT_AGE_SOURCES_1991)) {
      const adults = Object.values(source.adultCounts).reduce((sum, count) => sum + count, 0);
      expect(adults, key).toBeLessThan(source.sourcePopulation);
      expect(adults / source.sourcePopulation, key).toBeGreaterThan(0.5);
    }
  });
});
