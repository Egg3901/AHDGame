import { describe, expect, it } from "vitest";
import { cohortAgeShares1991 } from "./cohortAgeShares1991";
import { COHORT_AGE_PROFILES_1991 } from "../reference/cohortAgeProfiles1991";

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
