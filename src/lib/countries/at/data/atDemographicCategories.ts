import type { DemographicCategory } from "@/lib/db/types";

/**
 * Austria Voter Archetypes — 7 groups built around the three postwar Lager
 * (socialist, Catholic-conservative, national-liberal) plus the
 * Sozialpartnerschaft milieus that cut across them.
 *   defaultEconomicLean: -5 (socialist/left) … +5 (market/right)
 *   defaultSocialLean:   -5 (progressive/secular) … +5 (Catholic/traditional)
 * demographicProfileId "at_archetypes"; category _id "at_voterGroups".
 */
export const AT_VOTER_GROUP_BASELINES: Record<string, number> = {
  socialist_lager: 92,
  catholic_conservative: 92,
  national_liberal: 88,
  rural_farmer: 90,
  urban_worker: 91,
  business_professional: 90,
  communist_left: 84,
};

export const atDemographicCategories: DemographicCategory[] = [
  {
    _id: "at_voterGroups",
    name: "Austria Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "socialist_lager",
        name: "Socialist Lager",
        defaultEconomicLean: -3,
        defaultSocialLean: -1,
        defaultTurnout: 92,
      },
      {
        id: "catholic_conservative",
        name: "Catholic Conservative",
        defaultEconomicLean: 2,
        defaultSocialLean: 3,
        defaultTurnout: 92,
      },
      {
        id: "national_liberal",
        name: "National Liberal",
        defaultEconomicLean: 2,
        defaultSocialLean: 2,
        defaultTurnout: 88,
      },
      {
        id: "rural_farmer",
        name: "Rural Farmer",
        defaultEconomicLean: 1,
        defaultSocialLean: 3,
        defaultTurnout: 90,
      },
      {
        id: "urban_worker",
        name: "Urban Worker",
        defaultEconomicLean: -3,
        defaultSocialLean: 0,
        defaultTurnout: 91,
      },
      {
        id: "business_professional",
        name: "Business & Professional",
        defaultEconomicLean: 4,
        defaultSocialLean: 1,
        defaultTurnout: 90,
      },
      {
        id: "communist_left",
        name: "Communist Left",
        defaultEconomicLean: -5,
        defaultSocialLean: -2,
        defaultTurnout: 84,
      },
    ],
  },
];

export default atDemographicCategories;
