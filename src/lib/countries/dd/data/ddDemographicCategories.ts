import type { DemographicCategory } from "@/lib/db/types";

/**
 * East Germany Voter Archetypes — 6 groups of the 1979 GDR.
 *   defaultEconomicLean: -5 (planned/socialist) … +5 (market/reform)
 *   defaultSocialLean:   -5 (secular/liberal) … +5 (traditional)
 * demographicProfileId "dd_archetypes"; category _id "dd_voterGroups".
 */
export const DD_VOTER_GROUP_BASELINES: Record<string, number> = {
  party_nomenklatura: 96,
  industrial_worker: 95,
  collective_farmer: 94,
  intelligentsia: 95,
  christian_milieu: 92,
  youth: 90,
};

export const ddDemographicCategories: DemographicCategory[] = [
  {
    _id: "dd_voterGroups",
    name: "East Germany Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "party_nomenklatura",
        name: "Party Nomenklatura",
        defaultEconomicLean: -3,
        defaultSocialLean: 2,
        defaultTurnout: 96,
      },
      {
        id: "industrial_worker",
        name: "Industrial Worker",
        defaultEconomicLean: -3,
        defaultSocialLean: 0,
        defaultTurnout: 95,
      },
      {
        id: "collective_farmer",
        name: "Collective Farmer",
        defaultEconomicLean: -2,
        defaultSocialLean: 2,
        defaultTurnout: 94,
      },
      {
        id: "intelligentsia",
        name: "Technical Intelligentsia",
        defaultEconomicLean: 0,
        defaultSocialLean: -2,
        defaultTurnout: 95,
      },
      {
        id: "christian_milieu",
        name: "Christian Milieu",
        defaultEconomicLean: -1,
        defaultSocialLean: 3,
        defaultTurnout: 92,
      },
      {
        id: "youth",
        name: "FDJ Youth",
        defaultEconomicLean: -1,
        defaultSocialLean: -1,
        defaultTurnout: 90,
      },
    ],
  },
];

export default ddDemographicCategories;
