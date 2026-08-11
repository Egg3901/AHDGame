import type { DemographicCategory } from "@/lib/db/types";

/**
 * Japan Voter Archetypes — 10 mutually exclusive attitudinal/demographic groups
 * reflecting the Japanese political landscape.
 *
 * Design principle: each archetype is defined by attitudes and demographics,
 * not geography or party affiliation. Every group can exist in every region;
 * regional character is expressed through population percentages in
 * jpRegionDemographics.ts.
 *
 * Each group has:
 *   defaultEconomicLean: -5 (far left) to +5 (far right) on redistribution/market axis
 *   defaultSocialLean:   -5 (progressive/liberal) to +5 (conservative/traditional)
 *   defaultTurnout:      baseline participation rate (Japan avg ~53% in 2021 lower house)
 *
 * demographicProfileId: "jp_archetypes"
 */
export const JP_VOTER_GROUP_BASELINES: Record<string, number> = {
  salaryman_conservative: 65,
  urban_progressive: 68,
  rural_traditionalist: 70,
  young_urban: 48,
  retiree: 74,
  public_sector: 66,
  small_business: 68,
  komeito_faithful: 72,
  reform_populist: 55,
  working_mothers: 58,
};

export const jpDemographicCategories: DemographicCategory[] = [
  {
    _id: "jp_voterGroups",
    name: "Japan Voter Groups",
    defaultWeight: 100,
    groups: [
      /**
       * Salaryman Conservatives
       * Corporate employees in Japan's large companies. Economically moderate-right,
       * socially traditional. The backbone of LDP support. High organizational
       * turnout through company-linked networks (keiretsu voting).
       */
      {
        id: "salaryman_conservative",
        name: "Salaryman Conservatives",
        defaultEconomicLean: 1,
        defaultSocialLean: 1,
        defaultTurnout: 65,
      },
      /**
       * Urban Progressives
       * University-educated city dwellers, professionals in Tokyo, Osaka, Yokohama.
       * Pro-constitutional reform, anti-nuclear, pro-gender equality. Back CDP and
       * progressive parties. Japan's closest equivalent to Western urban liberals.
       */
      {
        id: "urban_progressive",
        name: "Urban Progressives",
        defaultEconomicLean: -2,
        defaultSocialLean: -3,
        defaultTurnout: 68,
      },
      /**
       * Rural Traditionalists
       * Farming communities and small towns outside metropolitan areas. Strong LDP
       * base going back decades — agricultural subsidies and public works spending
       * are core policy concerns. Socially very conservative.
       */
      {
        id: "rural_traditionalist",
        name: "Rural Traditionalists",
        defaultEconomicLean: 1,
        defaultSocialLean: 3,
        defaultTurnout: 70,
      },
      /**
       * Young Urban
       * Under-35 city residents. Japan's lowest-turnout demographic — political
       * disengagement is a defining trait. Mildly progressive on social issues,
       * economically uncertain. The "lost generation" and "ice age" generation.
       */
      {
        id: "young_urban",
        name: "Young Urban",
        defaultEconomicLean: -1,
        defaultSocialLean: -3,
        defaultTurnout: 48,
      },
      /**
       * Retirees & Elderly
       * Japan has the world's oldest population (~29% over 65). Highest turnout
       * of any demographic. Concerned with pensions, healthcare, elder care.
       * Broadly conservative, strong LDP loyalty from decades of dominance.
       */
      {
        id: "retiree",
        name: "Retirees & Elderly",
        defaultEconomicLean: 0,
        defaultSocialLean: 2,
        defaultTurnout: 74,
      },
      /**
       * Public Sector & Teachers
       * Government workers, educators, municipal employees. Historically aligned
       * with left-leaning unions (Rengo). Pro-public spending, moderately
       * progressive socially. Reliable turnout through union mobilization.
       */
      {
        id: "public_sector",
        name: "Public Sector & Teachers",
        defaultEconomicLean: -2,
        defaultSocialLean: -1,
        defaultTurnout: 66,
      },
      /**
       * Small Business & Self-Employed
       * Shop owners, sole traders, family businesses. Anti-regulation, concerned
       * with consumption tax burden. Economically right-leaning. Present across
       * all regions — the shotengai (shopping street) economy.
       */
      {
        id: "small_business",
        name: "Small Business & Self-Employed",
        defaultEconomicLean: 3,
        defaultSocialLean: 1,
        defaultTurnout: 68,
      },
      /**
       * Komeito Faithful
       * Soka Gakkai-aligned voters — Japan's largest religious organization.
       * Centrist on most issues, extremely reliable bloc turnout. Form the
       * LDP's permanent coalition partner. Concentrated in urban areas.
       */
      {
        id: "komeito_faithful",
        name: "Komeito Faithful",
        defaultEconomicLean: 0,
        defaultSocialLean: 0,
        defaultTurnout: 72,
      },
      /**
       * Reform Populists
       * Anti-establishment voters drawn to Nippon Ishin's deregulation message.
       * Strong in Kansai (Osaka base). Economically libertarian, socially moderate.
       * Want to shake up Japan's bureaucratic status quo.
       */
      {
        id: "reform_populist",
        name: "Reform Populists",
        defaultEconomicLean: 2,
        defaultSocialLean: 0,
        defaultTurnout: 55,
      },
      /**
       * Working Mothers
       * Women balancing career and family in Japan's rigid work culture.
       * Core policy issues: childcare access, work-life balance reform, gender
       * equality. Mildly progressive, pragmatic economically. Growing political
       * awareness as demographic decline makes women's participation essential.
       */
      {
        id: "working_mothers",
        name: "Working Mothers",
        defaultEconomicLean: -1,
        defaultSocialLean: -2,
        defaultTurnout: 58,
      },
    ],
  },
];

export default jpDemographicCategories;
