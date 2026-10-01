/** Portable resolution of the dated age-only proxies used for 1991 cohort stocks. */
import { COHORT_AGE_PROFILES_1991 } from "../reference/cohortAgeProfiles1991";

export function cohortAgeShares1991(
  countryId: string,
  regionId: string,
  preset: string
): { young: number; mid: number; mature: number; senior: number } | null {
  if (preset !== "1991-default") return null;
  if (countryId !== "FR" && countryId !== "ES") return null;
  const profile = COHORT_AGE_PROFILES_1991[countryId];
  if (!(profile.regionIds as readonly string[]).includes(regionId)) return null;
  const { adultCounts: counts, adultPopulation } = profile;
  return {
    young: (counts.young * 100) / adultPopulation,
    mid: (counts.mid * 100) / adultPopulation,
    mature: (counts.mature * 100) / adultPopulation,
    senior: (counts.senior * 100) / adultPopulation,
  };
}
