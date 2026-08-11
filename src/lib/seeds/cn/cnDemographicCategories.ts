import type { DemographicCategory } from "@/lib/db/types";

/**
 * China Voter Archetypes — 7 mutually-exclusive attitudinal/demographic
 * groups covering the contemporary Chinese political landscape.
 *
 * Design principle: each archetype is defined by socioeconomic position
 * and attitudes within the one-party system, not by party affiliation.
 * Every group can exist in every region; regional character is expressed
 * through population percentages in cnRegionDemographics.ts.
 *
 * Each group has:
 *   defaultEconomicLean: -5 (far left / redistribution) to +5 (far right / markets)
 *   defaultSocialLean:   -5 (progressive / liberal) to +5 (traditional / authoritarian)
 *   defaultTurnout:      baseline participation rate (NPC delegate elections)
 *
 * demographicProfileId: "cn_archetypes"
 */
export const CN_VOTER_GROUP_BASELINES: Record<string, number> = {
  party_cadre: 95,
  urban_professional: 88,
  rural_peasant: 82,
  industrial_worker: 86,
  migrant_worker: 65,
  entrepreneur: 90,
  youth: 78,
};

export const cnDemographicCategories: DemographicCategory[] = [
  {
    _id: "cn_voterGroups",
    name: "China Voter Groups",
    defaultWeight: 100,
    groups: [
      /**
       * Party Cadre & Officials
       * CCP members, government officials, state enterprise leadership.
       * Loyalist core of the system. Economically pragmatic (state
       * capitalism), strongly authoritarian-traditional social positions.
       * Near-universal NPC participation through party mobilization.
       */
      {
        id: "party_cadre",
        name: "Party Cadre & Officials",
        defaultEconomicLean: 0,
        defaultSocialLean: 3,
        defaultTurnout: 95,
      },
      /**
       * Urban Professional
       * Coastal city educated workers, tech sector employees, finance
       * professionals in Shanghai, Beijing, Shenzhen, Hangzhou. Emerging
       * middle class. Pro-market, cautiously reform-minded socially but
       * within system norms. High NPC engagement through workplace units.
       */
      {
        id: "urban_professional",
        name: "Urban Professional",
        defaultEconomicLean: 2,
        defaultSocialLean: 0,
        defaultTurnout: 88,
      },
      /**
       * Rural Peasantry
       * Farming communities in interior provinces, village residents.
       * Economically left-leaning (demand for rural subsidies, land
       * rights), socially traditional. High grassroots NPC turnout
       * through village committees.
       */
      {
        id: "rural_peasant",
        name: "Rural Peasantry",
        defaultEconomicLean: -2,
        defaultSocialLean: 2,
        defaultTurnout: 82,
      },
      /**
       * Industrial Worker
       * Manufacturing belt workers, state enterprise employees in
       * Dongbei rust belt, Pearl River factory towns, Yangtze corridor.
       * Pro-labor redistribution, moderate traditional social values.
       * Organized through enterprise-level NPC delegate selection.
       */
      {
        id: "industrial_worker",
        name: "Industrial Worker",
        defaultEconomicLean: -1,
        defaultSocialLean: 1,
        defaultTurnout: 86,
      },
      /**
       * Migrant Worker
       * Floating population (liudong renkou) — rural-origin workers
       * living and working in cities without local hukou registration.
       * Economically disadvantaged, socially in-between rural tradition
       * and urban aspiration. Lowest NPC participation due to registration
       * and bureaucratic barriers.
       */
      {
        id: "migrant_worker",
        name: "Migrant Worker",
        defaultEconomicLean: -2,
        defaultSocialLean: 1,
        defaultTurnout: 65,
      },
      /**
       * Private Entrepreneur
       * Alibaba-era business class, SME owners, private sector founders.
       * Economically pro-market, socially moderate-traditional. High
       * NPC engagement through business association channels and
       * CPPCC representation.
       */
      {
        id: "entrepreneur",
        name: "Private Entrepreneur",
        defaultEconomicLean: 3,
        defaultSocialLean: 1,
        defaultTurnout: 90,
      },
      /**
       * Youth (under-35)
       * Digital natives, university graduates, social media generation.
       * Aspirational economically, somewhat more progressive socially
       * while remaining within system bounds. Variable NPC participation —
       * peaks in years of strong nationalist or economic mobilization.
       */
      {
        id: "youth",
        name: "Youth (under-35)",
        defaultEconomicLean: 1,
        defaultSocialLean: -1,
        defaultTurnout: 78,
      },
    ],
  },
];
