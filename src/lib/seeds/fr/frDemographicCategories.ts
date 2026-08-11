import type { DemographicCategory } from "@/lib/db/types";

/**
 * France Voter Archetypes — 7 groups across the 1979 Fifth-Republic spectrum.
 * Region character comes from per-region shares derived from the FR Layer-1 model.
 *
 *   defaultEconomicLean: -5 (statist/left) … +5 (market/right)
 *   defaultSocialLean:   -5 (liberal/secular) … +5 (traditional/Catholic)
 *
 * demographicProfileId "fr_archetypes"; category _id "fr_voterGroups".
 */
export const FR_VOTER_GROUP_BASELINES: Record<string, number> = {
  bourgeois_right: 88,
  catholic_conservative: 86,
  centrist_liberal: 84,
  social_democrat: 84,
  communist_worker: 82,
  rural_farmer: 86,
  youth_student: 72,
};

export const frDemographicCategories: DemographicCategory[] = [
  {
    _id: "fr_voterGroups",
    name: "France Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "bourgeois_right",
        name: "Bourgeois Right",
        defaultEconomicLean: 3,
        defaultSocialLean: 2,
        defaultTurnout: 88,
      },
      {
        id: "catholic_conservative",
        name: "Catholic Conservative",
        defaultEconomicLean: 1,
        defaultSocialLean: 3,
        defaultTurnout: 86,
      },
      {
        id: "centrist_liberal",
        name: "Centrist Liberal",
        defaultEconomicLean: 1,
        defaultSocialLean: 0,
        defaultTurnout: 84,
      },
      {
        id: "social_democrat",
        name: "Social Democrat",
        defaultEconomicLean: -2,
        defaultSocialLean: -1,
        defaultTurnout: 84,
      },
      {
        id: "communist_worker",
        name: "Communist Worker",
        defaultEconomicLean: -4,
        defaultSocialLean: -1,
        defaultTurnout: 82,
      },
      {
        id: "rural_farmer",
        name: "Rural Farmer",
        defaultEconomicLean: 0,
        defaultSocialLean: 2,
        defaultTurnout: 86,
      },
      {
        id: "youth_student",
        name: "Youth & Students",
        defaultEconomicLean: -1,
        defaultSocialLean: -2,
        defaultTurnout: 72,
      },
    ],
  },
];

export default frDemographicCategories;
