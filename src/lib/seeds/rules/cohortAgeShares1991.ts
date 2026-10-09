/** Portable resolution of the dated age-only proxies used for 1991 cohort stocks. */
import { COHORT_AGE_PROFILES_1991 } from "../reference/cohortAgeProfiles1991";
import {
  COHORT_AGE_SOURCES_1991,
  COHORT_NATIONAL_SOURCE_1991,
  COHORT_REGION_SOURCE_1991,
  type CohortAdultCounts,
} from "../reference/cohortAgeSources1991";

export type CohortAgeShares = { young: number; mid: number; mature: number; senior: number };

function sharesOf(counts: CohortAdultCounts): CohortAgeShares {
  const adults = counts.young + counts.mid + counts.mature + counts.senior;
  return {
    young: (counts.young * 100) / adults,
    mid: (counts.mid * 100) / adults,
    mature: (counts.mature * 100) / adults,
    senior: (counts.senior * 100) / adults,
  };
}

/**
 * Source key of the dated age-only proxy for a 1991 region, or null when the
 * region has none. A region override (Soviet union republic, Yugoslav
 * republic, Slovakia) wins over the country's national source. Unknown union
 * republics and Yugoslav regions resolve to null rather than borrowing a
 * neighbour's shape.
 */
export function cohortAgeSource1991(countryId: string, regionId: string): string | null {
  const override = COHORT_REGION_SOURCE_1991[regionId];
  if (override) return override.countryId === countryId ? override.source : null;
  if (countryId === "RU" && regionId.startsWith("SU_")) return null;
  return COHORT_NATIONAL_SOURCE_1991[countryId] ?? null;
}

export function cohortAgeShares1991(
  countryId: string,
  regionId: string,
  preset: string
): CohortAgeShares | null {
  if (preset !== "1991-default") return null;
  if (countryId === "FR" || countryId === "ES") {
    const profile = COHORT_AGE_PROFILES_1991[countryId];
    if (!(profile.regionIds as readonly string[]).includes(regionId)) return null;
    return sharesOf(profile.adultCounts);
  }
  const source = cohortAgeSource1991(countryId, regionId);
  if (!source) return null;
  const row = COHORT_AGE_SOURCES_1991[source];
  return row ? sharesOf(row.adultCounts) : null;
}
