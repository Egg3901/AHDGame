import type { DemographicCategory } from "@/lib/db/types";

/**
 * Germany Voter Archetypes — 12 mutually-exclusive attitudinal/demographic
 * groups covering the post-2021 German political landscape.
 *
 * Design principle: each archetype is defined by attitudes and demographics,
 * not geography or party affiliation. Every group can exist in every
 * Bundesland; regional character is expressed through population percentages
 * in deRegionDemographics.ts.
 *
 * Each group has:
 *   defaultEconomicLean: -5 (far left / redistribution) to +5 (far right / markets)
 *   defaultSocialLean:   -5 (progressive / liberal) to +5 (traditional / authoritarian)
 *   defaultTurnout:      baseline participation rate (German Bundestag avg ~76.6% in 2021)
 *
 * demographicProfileId: "de_archetypes"
 */
export const DE_GROUP_EN_LABELS: Record<string, string> = {
  katholische_konservative: "Catholic Conservatives",
  gewerkschafter: "Union Workers",
  urbane_progressive: "Urban Progressives",
  wirtschaftsliberale: "Business Liberals",
  ost_post_industriell: "Eastern Post-Industrial",
  gruene_mittelschicht: "Green Middle Class",
  rentner_west: "West-German Retirees",
  migranten_communities: "Migrant-Background Communities",
  landwirte_dorf: "Farmers & Rural Village",
  junge_grossstadt: "Young Urban",
  protest_waehler_ost: "Eastern Protest Voters",
  mittelstand_selbstaendige: "Self-Employed Mittelstand",
};

export const DE_VOTER_GROUP_BASELINES: Record<string, number> = {
  katholische_konservative: 82,
  gewerkschafter: 78,
  urbane_progressive: 80,
  wirtschaftsliberale: 83,
  ost_post_industriell: 70,
  gruene_mittelschicht: 85,
  rentner_west: 86,
  migranten_communities: 62,
  landwirte_dorf: 80,
  junge_grossstadt: 63,
  protest_waehler_ost: 72,
  mittelstand_selbstaendige: 82,
};

export const deDemographicCategories: DemographicCategory[] = [
  {
    _id: "de_voterGroups",
    name: "Germany Voter Groups",
    defaultWeight: 100,
    groups: [
      /**
       * Katholische Konservative (Catholic Conservatives)
       * Churchgoing rural and suburban voters in Bavaria, Baden-Württemberg,
       * Münsterland. CDU/CSU bedrock. Economically moderate-right, socially
       * traditional, pro-family, pro-EU. Very high turnout through parish
       * and Verein networks.
       */
      {
        id: "katholische_konservative",
        name: "Katholische Konservative",
        defaultEconomicLean: 2,
        defaultSocialLean: 2,
        defaultTurnout: 82,
      },
      /**
       * Gewerkschafter (Union Workers)
       * Industrial and service-sector workers tied to IG Metall, ver.di, IG BCE.
       * Traditional SPD base; defecting toward AfD and Linke in recent cycles.
       * Pro-redistribution, pro-industry subsidy, skeptical of austerity.
       * Concentrated in NRW, Lower Saxony, Saarland.
       */
      {
        id: "gewerkschafter",
        name: "Gewerkschafter",
        defaultEconomicLean: -3,
        defaultSocialLean: 0,
        defaultTurnout: 78,
      },
      /**
       * Urbane Progressive (Urban Progressives)
       * University-educated professionals in Berlin, Hamburg, Munich, Cologne,
       * Frankfurt. Split between SPD and Greens. Pro-climate, pro-diversity,
       * pro-EU, socially very progressive. Core Ampel-coalition voters.
       */
      {
        id: "urbane_progressive",
        name: "Urbane Progressive",
        defaultEconomicLean: -2,
        defaultSocialLean: -3,
        defaultTurnout: 80,
      },
      /**
       * Wirtschaftsliberale (Business Liberals)
       * Corporate professionals, management, export-oriented industries. Core
       * FDP support; also compete with CDU. Pro-markets, anti-regulation,
       * socially moderate, strongly pro-EU for trade reasons.
       */
      {
        id: "wirtschaftsliberale",
        name: "Wirtschaftsliberale",
        defaultEconomicLean: 3,
        defaultSocialLean: -1,
        defaultTurnout: 83,
      },
      /**
       * Ost-Post-Industriell (Eastern Post-Industrial)
       * Former GDR workers and pensioners in Saxony-Anhalt, Thuringia, northern
       * Brandenburg. Hit hardest by reunification; economically anxious,
       * skeptical of western elites. Split between Linke's social promises
       * and AfD's cultural grievances.
       */
      {
        id: "ost_post_industriell",
        name: "Ost-Post-Industriell",
        defaultEconomicLean: -2,
        defaultSocialLean: 2,
        defaultTurnout: 70,
      },
      /**
       * Grüne Mittelschicht (Green Middle Class)
       * Teachers, academics, public-sector professionals, civic association
       * members. Hard core of Grüne support. Climate-first, pro-immigration,
       * pro-renewable energy transition. Overrepresented in Baden-Württemberg
       * and Hessen.
       */
      {
        id: "gruene_mittelschicht",
        name: "Grüne Mittelschicht",
        defaultEconomicLean: -1,
        defaultSocialLean: -4,
        defaultTurnout: 85,
      },
      /**
       * Rentner West (West-German Retirees)
       * Over-65 Wessis who grew up under Wirtschaftswunder Germany. Homeowners,
       * pensioners, small savers. Strongly CDU; some SPD. Risk-averse on economy,
       * socially traditional but pragmatic on EU. Extremely reliable turnout.
       */
      {
        id: "rentner_west",
        name: "Rentner West",
        defaultEconomicLean: 1,
        defaultSocialLean: 2,
        defaultTurnout: 86,
      },
      /**
       * Migranten-Communities (Migrant-Background Voters)
       * Turkish-German, Russian-German, Arab-German, Southeast European citizens.
       * Lean SPD and Greens on social policy; economically mixed. Lower turnout
       * due to engagement barriers, though second-generation rates are rising.
       * Concentrated in NRW, Hamburg, Berlin.
       */
      {
        id: "migranten_communities",
        name: "Migranten-Communities",
        defaultEconomicLean: -1,
        defaultSocialLean: -2,
        defaultTurnout: 62,
      },
      /**
       * Landwirte und Dorfgemeinschaft (Farmers & Rural Village)
       * Small and mid-scale farmers, rural tradespeople. CDU/CSU strongholds in
       * Bavaria, Lower Saxony, and the Münsterland. Defend EU agricultural
       * subsidies (CAP), skeptical of Green regulatory agenda. Traditionalist.
       */
      {
        id: "landwirte_dorf",
        name: "Landwirte und Dorfgemeinschaft",
        defaultEconomicLean: 1,
        defaultSocialLean: 3,
        defaultTurnout: 80,
      },
      /**
       * Junge Großstadt (Young Urban)
       * Students, creatives, under-35 knowledge workers in Berlin, Leipzig,
       * Cologne, Hamburg. Split Green/Linke, with smaller SPD share. Very
       * progressive on climate, housing, and identity; economically favor
       * redistribution. Volatile turnout — peaks in competitive cycles.
       */
      {
        id: "junge_grossstadt",
        name: "Junge Großstadt",
        defaultEconomicLean: -3,
        defaultSocialLean: -4,
        defaultTurnout: 63,
      },
      /**
       * Protest-Wähler (Ost) (Eastern Protest Voters)
       * Anti-establishment voters across Saxony, Thuringia, Mecklenburg-Vorpommern.
       * Economically anxious, culturally conservative, deeply suspicious of the
       * Berlin political class. The AfD's eastern core — distinct from
       * western right-populist voters.
       */
      {
        id: "protest_waehler_ost",
        name: "Protest-Wähler (Ost)",
        defaultEconomicLean: 0,
        defaultSocialLean: 4,
        defaultTurnout: 72,
      },
      /**
       * Mittelstand-Selbstständige (Self-Employed Mittelstand)
       * Owners of small and mid-sized businesses (the famous Mittelstand) —
       * mechanical engineers, regional manufacturers, Handwerksmeister. Core
       * FDP/CDU. Pro-export, anti-bureaucracy, moderate-traditional on social
       * issues. Major weight in Baden-Württemberg, Bavaria, NRW.
       */
      {
        id: "mittelstand_selbstaendige",
        name: "Mittelstand-Selbstständige",
        defaultEconomicLean: 3,
        defaultSocialLean: 1,
        defaultTurnout: 82,
      },
    ],
  },
];
