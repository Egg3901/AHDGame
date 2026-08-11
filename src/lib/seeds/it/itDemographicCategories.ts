import type { DemographicCategory } from "@/lib/db/types";

/**
 * Italy Voter Archetypes — 7 groups across the 1979 First-Republic spectrum.
 *   defaultEconomicLean: -5 (statist/left) … +5 (market/right)
 *   defaultSocialLean:   -5 (secular/liberal) … +5 (traditional/Catholic)
 * demographicProfileId "it_archetypes"; category _id "it_voterGroups".
 */
export const IT_VOTER_GROUP_BASELINES: Record<string, number> = {
  catholic_dc: 90,
  industrial_north: 90,
  communist_worker: 90,
  socialist: 88,
  southern_client: 86,
  secular_liberal: 90,
  youth_radical: 78,
};

export const itDemographicCategories: DemographicCategory[] = [
  {
    _id: "it_voterGroups",
    name: "Italy Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "catholic_dc",
        name: "Catholic / DC Base",
        defaultEconomicLean: 1,
        defaultSocialLean: 3,
        defaultTurnout: 90,
      },
      {
        id: "industrial_north",
        name: "Northern Industrialist",
        defaultEconomicLean: 3,
        defaultSocialLean: 1,
        defaultTurnout: 90,
      },
      {
        id: "communist_worker",
        name: "Communist Worker",
        defaultEconomicLean: -4,
        defaultSocialLean: -1,
        defaultTurnout: 90,
      },
      {
        id: "socialist",
        name: "Socialist",
        defaultEconomicLean: -2,
        defaultSocialLean: -1,
        defaultTurnout: 88,
      },
      {
        id: "southern_client",
        name: "Southern Clientelist",
        defaultEconomicLean: -1,
        defaultSocialLean: 2,
        defaultTurnout: 86,
      },
      {
        id: "secular_liberal",
        name: "Secular Liberal",
        defaultEconomicLean: 1,
        defaultSocialLean: -1,
        defaultTurnout: 90,
      },
      {
        id: "youth_radical",
        name: "Radical Youth",
        defaultEconomicLean: -2,
        defaultSocialLean: -3,
        defaultTurnout: 78,
      },
    ],
  },
];

export default itDemographicCategories;
