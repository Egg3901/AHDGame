import type { DemographicCategory } from "@/lib/db/types";

/**
 * Spain Voter Archetypes — 7 groups across the 1979 Transition spectrum.
 *   defaultEconomicLean: -5 (statist/left) … +5 (market/right)
 *   defaultSocialLean:   -5 (secular/progressive) … +5 (traditional/Catholic)
 * demographicProfileId "es_archetypes"; category _id "es_voterGroups".
 */
export const ES_VOTER_GROUP_BASELINES: Record<string, number> = {
  conservative_catholic: 70,
  centrist: 72,
  socialist_worker: 72,
  communist_worker: 70,
  regional_nationalist: 72,
  urban_professional: 76,
  youth_democratic: 62,
};

export const esDemographicCategories: DemographicCategory[] = [
  {
    _id: "es_voterGroups",
    name: "Spain Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "conservative_catholic",
        name: "Conservative Catholic",
        defaultEconomicLean: 2,
        defaultSocialLean: 3,
        defaultTurnout: 70,
      },
      {
        id: "centrist",
        name: "Centrist",
        defaultEconomicLean: 1,
        defaultSocialLean: 1,
        defaultTurnout: 72,
      },
      {
        id: "socialist_worker",
        name: "Socialist Worker",
        defaultEconomicLean: -2,
        defaultSocialLean: -2,
        defaultTurnout: 72,
      },
      {
        id: "communist_worker",
        name: "Communist Worker",
        defaultEconomicLean: -4,
        defaultSocialLean: -2,
        defaultTurnout: 70,
      },
      {
        id: "regional_nationalist",
        name: "Regional Nationalist",
        defaultEconomicLean: 0,
        defaultSocialLean: -1,
        defaultTurnout: 72,
      },
      {
        id: "urban_professional",
        name: "Urban Professional",
        defaultEconomicLean: 1,
        defaultSocialLean: -1,
        defaultTurnout: 76,
      },
      {
        id: "youth_democratic",
        name: "Democratic Youth",
        defaultEconomicLean: -2,
        defaultSocialLean: -3,
        defaultTurnout: 62,
      },
    ],
  },
];

export default esDemographicCategories;
