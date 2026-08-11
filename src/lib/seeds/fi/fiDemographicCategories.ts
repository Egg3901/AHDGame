import type { DemographicCategory } from "@/lib/db/types";

/**
 * Finland Voter Archetypes — 7 groups across the postwar multiparty field.
 *   defaultEconomicLean: -5 (socialist/left) … +5 (market/right)
 *   defaultSocialLean:   -5 (progressive/secular) … +5 (agrarian/traditional)
 * demographicProfileId "fi_archetypes"; category _id "fi_voterGroups".
 */
export const FI_VOTER_GROUP_BASELINES: Record<string, number> = {
  social_democrat: 82,
  agrarian_centre: 82,
  conservative_right: 82,
  communist_left: 80,
  swedish_liberal: 82,
  urban_worker: 80,
  rural_smallholder: 80,
};

export const fiDemographicCategories: DemographicCategory[] = [
  {
    _id: "fi_voterGroups",
    name: "Finland Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "social_democrat",
        name: "Social Democrat",
        defaultEconomicLean: -2,
        defaultSocialLean: -1,
        defaultTurnout: 82,
      },
      {
        id: "agrarian_centre",
        name: "Agrarian Centre",
        defaultEconomicLean: 0,
        defaultSocialLean: 3,
        defaultTurnout: 82,
      },
      {
        id: "conservative_right",
        name: "Conservative Right",
        defaultEconomicLean: 3,
        defaultSocialLean: 2,
        defaultTurnout: 82,
      },
      {
        id: "communist_left",
        name: "Communist Left",
        defaultEconomicLean: -4,
        defaultSocialLean: -1,
        defaultTurnout: 80,
      },
      {
        id: "swedish_liberal",
        name: "Swedish-Speaking Liberal",
        defaultEconomicLean: 1,
        defaultSocialLean: 0,
        defaultTurnout: 82,
      },
      {
        id: "urban_worker",
        name: "Urban Worker",
        defaultEconomicLean: -3,
        defaultSocialLean: -1,
        defaultTurnout: 80,
      },
      {
        id: "rural_smallholder",
        name: "Rural Smallholder",
        defaultEconomicLean: 0,
        defaultSocialLean: 3,
        defaultTurnout: 80,
      },
    ],
  },
];

export default fiDemographicCategories;
