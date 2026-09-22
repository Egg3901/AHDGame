import type { DemographicCategory } from "@/lib/db/types";

/**
 * Ireland Voter Archetypes — 8 mutually-exclusive attitudinal/demographic
 * groups covering the contemporary Irish political landscape.
 *
 * Design principle: each archetype is defined by attitudes and demographics,
 * not geography or party affiliation. Every group can exist in every region;
 * regional character is expressed through population percentages in
 * ieRegionDemographics.ts.
 *
 * Each group has:
 *   defaultEconomicLean: -5 (far left / redistribution) to +5 (far right / markets)
 *   defaultSocialLean:   -5 (progressive / liberal) to +5 (traditional / authoritarian)
 *   defaultTurnout:      baseline participation rate (Dáil elections avg ~62%)
 *
 * demographicProfileId: "ie_archetypes"
 */
export const IE_VOTER_GROUP_BASELINES: Record<string, number> = {
  urban_professional: 68,
  rural_traditional: 72,
  working_class: 58,
  new_irish: 45,
  small_business: 74,
  retirees: 80,
  young_urban: 46,
  border_communities: 65,
};

export const ieDemographicCategories: DemographicCategory[] = [
  {
    _id: "ie_voterGroups",
    name: "Ireland Voter Groups",
    defaultWeight: 100,
    groups: [
      /**
       * Urban Professional
       * Dublin and Cork well-educated workers in tech, finance, and professional
       * services. Fine Gael lean. Pro-market, socially liberal, pro-EU. Benefited
       * most from the Celtic Tiger and FDI boom.
       */
      {
        id: "urban_professional",
        name: "Urban Professional",
        defaultEconomicLean: 2,
        defaultSocialLean: -2,
        defaultTurnout: 68,
      },
      /**
       * Rural Traditional
       * Farming community, GAA culture, and rural parish life. The historical
       * Fianna Fáil and Fine Gael base. Economically moderate, socially
       * conservative, deeply rooted in local community networks.
       */
      {
        id: "rural_traditional",
        name: "Rural Traditional",
        defaultEconomicLean: 1,
        defaultSocialLean: 2,
        defaultTurnout: 72,
      },
      /**
       * Working Class
       * Trade union members, manufacturing workers, and public-sector employees
       * in Dublin suburbs and provincial towns. Traditional Labour and Sinn Féin
       * base. Pro-redistribution, pro-public services, skeptical of austerity.
       */
      {
        id: "working_class",
        name: "Working Class",
        defaultEconomicLean: -3,
        defaultSocialLean: 0,
        defaultTurnout: 58,
      },
      /**
       * New Irish
       * Recent migrants from EU accession states, Africa, Asia, and beyond.
       * Diverse political backgrounds; generally centre-left on social issues.
       * Lower turnout due to registration barriers and unfamiliarity with
       * Irish electoral system.
       */
      {
        id: "new_irish",
        name: "New Irish",
        defaultEconomicLean: -1,
        defaultSocialLean: -2,
        defaultTurnout: 45,
      },
      /**
       * Small Business & Farmers
       * Self-employed tradespeople, SME owners, and family farm operators.
       * Fine Gael and Fianna Fáil lean. Pro-enterprise, anti-regulation,
       * concerned about CAP subsidies and local planning. High civic engagement.
       */
      {
        id: "small_business",
        name: "Small Business & Farmers",
        defaultEconomicLean: 2,
        defaultSocialLean: 1,
        defaultTurnout: 74,
      },
      /**
       * Retirees
       * Older voters focused on pensions, healthcare, and State services.
       * Conservative on social change but pragmatic on welfare spending.
       * Extremely reliable turnout; heavily courted by all parties.
       */
      {
        id: "retirees",
        name: "Retirees",
        defaultEconomicLean: 0,
        defaultSocialLean: 1,
        defaultTurnout: 80,
      },
      /**
       * Young Urban
       * Under-35 city dwellers in Dublin, Cork, Galway, and Limerick.
       * Sinn Féin and Green Party lean. Driven by housing affordability, climate
       * action, and a rejection of the FG/FF duopoly. Volatile but growing share.
       */
      {
        id: "young_urban",
        name: "Young Urban",
        defaultEconomicLean: -2,
        defaultSocialLean: -3,
        defaultTurnout: 46,
      },
      /**
       * Border Communities
       * Residents of the Ulster border region with close North–South ties,
       * cross-border employment, and unique concerns around partition and the
       * Good Friday Agreement. Sinn Féin lean; acutely sensitive to Brexit
       * fallout and any future constitutional referendum.
       */
      {
        id: "border_communities",
        name: "Border Communities",
        defaultEconomicLean: -1,
        defaultSocialLean: -1,
        defaultTurnout: 65,
      },
    ],
  },
];
