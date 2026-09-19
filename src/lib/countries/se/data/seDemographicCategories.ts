import type { DemographicCategory } from "@/lib/db/types";

/**
 * Sweden Voter Archetypes — 7 groups across the 1979 Swedish-model spectrum.
 *   defaultEconomicLean: -5 (statist/left) … +5 (market/right)
 *   defaultSocialLean:   -5 (secular/progressive) … +5 (traditional)
 * demographicProfileId "se_archetypes"; category _id "se_voterGroups".
 */
export const SE_VOTER_GROUP_BASELINES: Record<string, number> = {
  blue_collar_sap: 92,
  public_sector_left: 92,
  business_conservative: 93,
  agrarian_centrist: 90,
  liberal_urban: 92,
  radical_left: 88,
  rural_north: 90,
};

export const seDemographicCategories: DemographicCategory[] = [
  {
    _id: "se_voterGroups",
    name: "Sweden Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "blue_collar_sap",
        name: "Blue-Collar (LO/SAP)",
        defaultEconomicLean: -3,
        defaultSocialLean: -1,
        defaultTurnout: 92,
      },
      {
        id: "public_sector_left",
        name: "Public-Sector Left",
        defaultEconomicLean: -2,
        defaultSocialLean: -2,
        defaultTurnout: 92,
      },
      {
        id: "business_conservative",
        name: "Business Conservative",
        defaultEconomicLean: 3,
        defaultSocialLean: 1,
        defaultTurnout: 93,
      },
      {
        id: "agrarian_centrist",
        name: "Agrarian Centrist",
        defaultEconomicLean: 0,
        defaultSocialLean: 0,
        defaultTurnout: 90,
      },
      {
        id: "liberal_urban",
        name: "Urban Liberal",
        defaultEconomicLean: 1,
        defaultSocialLean: -2,
        defaultTurnout: 92,
      },
      {
        id: "radical_left",
        name: "Radical Left",
        defaultEconomicLean: -4,
        defaultSocialLean: -2,
        defaultTurnout: 88,
      },
      {
        id: "rural_north",
        name: "Rural North",
        defaultEconomicLean: -1,
        defaultSocialLean: 0,
        defaultTurnout: 90,
      },
    ],
  },
];

export default seDemographicCategories;
