import type { DemographicCategory } from "@/lib/db/types";

/**
 * Brazil Voter Archetypes — 8 mutually-exclusive attitudinal/demographic
 * groups covering the post-2018 Brazilian political landscape.
 *
 * Design principle: each archetype is defined by attitudes and demographics,
 * not geography or party affiliation. Every group can exist in every
 * macro-region; regional character is expressed through population percentages
 * in brRegionDemographics.ts.
 *
 * Each group has:
 *   defaultEconomicLean: -5 (far left / redistribution) to +5 (far right / markets)
 *   defaultSocialLean:   -5 (progressive / liberal) to +5 (traditional / authoritarian)
 *   defaultTurnout:      baseline participation rate (Brazilian TSE avg ~79% in 2022)
 *
 * demographicProfileId: "br_archetypes"
 */
export const BR_VOTER_GROUP_BASELINES: Record<string, number> = {
  evangelical_conservative: 80,
  working_class_pt: 76,
  rural_agribusiness: 72,
  urban_middle_class: 78,
  urban_poor: 68,
  afro_brazilian: 62,
  business_financial: 82,
  young_progressive: 54,
};

export const brDemographicCategories: DemographicCategory[] = [
  {
    _id: "br_voterGroups",
    name: "Brazil Voter Groups",
    defaultWeight: 100,
    groups: [
      /**
       * Evangelical Conservative
       * Bolsonaro/PL base; Pentecostal and evangelical church networks. Strongly
       * traditional on family, sexuality, and drugs. Economically pragmatic —
       * supports some welfare but also market liberalisation. Fastest-growing
       * demographic in Brazil; concentrated in Norte and Centro-Oeste.
       */
      {
        id: "evangelical_conservative",
        name: "Evangelical Conservative",
        defaultEconomicLean: 1,
        defaultSocialLean: 4,
        defaultTurnout: 80,
      },
      /**
       * Organized Labour
       * PT/CUT union base; formal-sector workers in industry and public services.
       * Pro-redistribution, pro-welfare state, pro-workers' rights. Traditional
       * Lulista heartland in ABC Paulista, Nordeste industrial centres, Belém.
       */
      {
        id: "working_class_pt",
        name: "Organized Labour",
        defaultEconomicLean: -3,
        defaultSocialLean: -1,
        defaultTurnout: 76,
      },
      /**
       * Rural & Agribusiness
       * Bancada Ruralista; large soy and beef producers; the interior frontier.
       * Pro-market on agriculture, anti-environmental regulation, traditional
       * socially. Dominant in Centro-Oeste and Sul interior.
       */
      {
        id: "rural_agribusiness",
        name: "Rural & Agribusiness",
        defaultEconomicLean: 2,
        defaultSocialLean: 3,
        defaultTurnout: 72,
      },
      /**
       * Urban Middle Class
       * Anti-PT professionals in São Paulo and Rio de Janeiro; reformist;
       * prioritise fiscal responsibility, anti-corruption, security. Supported
       * Bolsonaro in 2018 but split in 2022.
       */
      {
        id: "urban_middle_class",
        name: "Urban Middle Class",
        defaultEconomicLean: 1,
        defaultSocialLean: 0,
        defaultTurnout: 78,
      },
      /**
       * Urban Poor
       * Favela residents and informal-economy workers; Bolsa Família recipients.
       * Strong PT lean on economic policy; socially mixed but anti-establishment.
       * Concentrated in Nordeste and major Sudeste metros.
       */
      {
        id: "urban_poor",
        name: "Urban Poor",
        defaultEconomicLean: -4,
        defaultSocialLean: -1,
        defaultTurnout: 68,
      },
      /**
       * Afro-Brazilian Communities
       * Quilombo descendants and wider Afro-Brazilian civil society; progressive
       * on racial equity and social policy. PT-leaning. Concentrated in Nordeste
       * and urban Sudeste peripheries.
       */
      {
        id: "afro_brazilian",
        name: "Afro-Brazilian Communities",
        defaultEconomicLean: -2,
        defaultSocialLean: -2,
        defaultTurnout: 62,
      },
      /**
       * Business & Finance
       * Paulista market liberals; investment banks, agribusiness finance,
       * tech entrepreneurs. Strong preference for fiscal austerity, privatisation,
       * and central bank independence. Low party loyalty; mobilise around credibility.
       */
      {
        id: "business_financial",
        name: "Business & Finance",
        defaultEconomicLean: 3,
        defaultSocialLean: 1,
        defaultTurnout: 82,
      },
      /**
       * Young Progressive
       * University students and early-career urban youth; social-media activism;
       * climate, racial justice, LGBTQ+ rights. PT/PSOL lean. Volatile turnout —
       * peaks in highly competitive cycles.
       */
      {
        id: "young_progressive",
        name: "Young Progressive",
        defaultEconomicLean: -2,
        defaultSocialLean: -3,
        defaultTurnout: 54,
      },
    ],
  },
];
