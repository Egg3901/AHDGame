import type { CountryLayer1Model } from "@/lib/seeds/international/types";
import { RU_ADULT_CENSUS_2021, RU_ADULT_COHORT_IDS } from "./data/ruAdultCensus2021";

/**
 * Contemporary Russian Layer-1 model. The eight mutually exclusive adult
 * groups have measured 2021 census shares. Turnout 55 and the small social
 * leans are neutral gameplay assumptions, not observed voting preferences.
 * No Soviet occupation or party archetype is carried into this model.
 */
export function getRuModernModel(): CountryLayer1Model {
  const groupIds = [...RU_ADULT_COHORT_IDS];
  const census = Object.fromEntries(
    Object.entries(RU_ADULT_CENSUS_2021).map(([regionId, counts]) => {
      const total = counts.reduce((sum, count) => sum + count, 0);
      return [
        regionId,
        {
          cohortPlace: Object.fromEntries(groupIds.map((id, i) => [id, (counts[i] / total) * 100])),
        },
      ];
    })
  );
  const positions = Object.fromEntries(
    groupIds.map((id) => {
      const ageLean = id.includes("18_34") ? -0.5 : id.includes("65_plus") ? 0.5 : 0;
      const placeLean = id.startsWith("rural") ? 0.5 : -0.5;
      return [id, { economicLean: 0, socialLean: ageLean + placeLean }];
    })
  );
  return {
    countryId: "RU",
    categoryId: "ru_voterGroups",
    groupIds,
    dims: ["cohortPlace"],
    census,
    composition: Object.fromEntries(
      groupIds.map((id) => [id, { weights: [{ dim: "cohortPlace", key: id, w: 1 }] }])
    ),
    turnoutRates: { cohortPlace: Object.fromEntries(groupIds.map((id) => [id, 55])) },
    positions: { cohortPlace: positions },
    defaultLeans: positions,
  };
}
