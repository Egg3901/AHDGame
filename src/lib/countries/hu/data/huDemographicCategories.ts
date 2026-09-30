import type { DemographicCategory } from "@/lib/db/types";

/**
 * Hungary Voter Archetypes — 6 groups across the Third-Republic spectrum
 * (2027 world). Post-1989 cleavages: the national-conservative rural base vs
 * the Budapest liberal professional class, a residual industrial left, a
 * green youth, and a distinct Roma minority concentrated in the northeast
 * and the Plain with structurally lower turnout.
 *   defaultEconomicLean: -5 (redistributive/left) … +5 (market/right)
 *   defaultSocialLean:   -5 (liberal/progressive) … +5 (traditional/national)
 * demographicProfileId "hu_archetypes"; category _id "hu_voterGroups".
 *
 * Cold-War HU worlds seed this same category id from the shared
 * makeEasternBlocCategories builder instead (one world runs one preset, so
 * the two contents never coexist).
 */
export const HU_VOTER_GROUP_BASELINES: Record<string, number> = {
  national_conservative: 74,
  christian_rural: 72,
  urban_liberal: 70,
  socialist_left: 68,
  green_youth: 64,
  roma_minority: 52,
};

export const huDemographicCategories: DemographicCategory[] = [
  {
    _id: "hu_voterGroups",
    name: "Hungary Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "national_conservative",
        name: "National Conservative",
        defaultEconomicLean: 1,
        defaultSocialLean: 4,
        defaultTurnout: 74,
      },
      {
        id: "christian_rural",
        name: "Christian Rural",
        defaultEconomicLean: 0,
        defaultSocialLean: 5,
        defaultTurnout: 72,
      },
      {
        id: "urban_liberal",
        name: "Urban Liberal",
        defaultEconomicLean: 1,
        defaultSocialLean: -3,
        defaultTurnout: 70,
      },
      {
        id: "socialist_left",
        name: "Socialist Left",
        defaultEconomicLean: -3,
        defaultSocialLean: -1,
        defaultTurnout: 68,
      },
      {
        id: "green_youth",
        name: "Green Youth",
        defaultEconomicLean: -1,
        defaultSocialLean: -4,
        defaultTurnout: 64,
      },
      {
        id: "roma_minority",
        name: "Roma Minority",
        defaultEconomicLean: -2,
        defaultSocialLean: 1,
        defaultTurnout: 52,
      },
    ],
  },
];

export default huDemographicCategories;
