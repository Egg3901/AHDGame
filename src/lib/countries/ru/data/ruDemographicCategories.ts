import type { DemographicCategory } from "@/lib/db/types";

/**
 * USSR Voter Archetypes — 7 mutually-exclusive groups covering late-Soviet
 * society (1979). Each group exists in every region; regional character comes
 * from the per-region population shares derived from the Layer-1 model.
 *
 *   defaultEconomicLean: -5 (command economy / state-control) to +5 (market-reform)
 *   defaultSocialLean:   -5 (cosmopolitan/liberal) to +5 (traditional/nationalist)
 *
 * demographicProfileId: "su_archetypes"; category _id "su_voterGroups" matches
 * the SU Layer-1 model categoryId.
 */
export const SU_VOTER_GROUP_BASELINES: Record<string, number> = {
  party_nomenklatura: 95,
  industrial_worker: 88,
  collective_farmer: 86,
  urban_professional: 85,
  intelligentsia: 88,
  national_minority: 82,
  youth: 78,
};

export const ruDemographicCategories: DemographicCategory[] = [
  {
    _id: "su_voterGroups",
    name: "USSR Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "party_nomenklatura",
        name: "Party Nomenklatura",
        defaultEconomicLean: -1,
        defaultSocialLean: 3,
        defaultTurnout: 95,
      },
      {
        id: "industrial_worker",
        name: "Industrial Worker",
        defaultEconomicLean: -2,
        defaultSocialLean: 1,
        defaultTurnout: 88,
      },
      {
        id: "collective_farmer",
        name: "Collective Farmer",
        defaultEconomicLean: -2,
        defaultSocialLean: 2,
        defaultTurnout: 86,
      },
      {
        id: "urban_professional",
        name: "Urban Professional",
        defaultEconomicLean: 0,
        defaultSocialLean: 0,
        defaultTurnout: 85,
      },
      {
        id: "intelligentsia",
        name: "Intelligentsia",
        defaultEconomicLean: 0,
        defaultSocialLean: -1,
        defaultTurnout: 88,
      },
      {
        id: "national_minority",
        name: "National Minority",
        defaultEconomicLean: -1,
        defaultSocialLean: 2,
        defaultTurnout: 82,
      },
      {
        id: "youth",
        name: "Youth",
        defaultEconomicLean: 0,
        defaultSocialLean: -1,
        defaultTurnout: 78,
      },
    ],
  },
];

export default ruDemographicCategories;
