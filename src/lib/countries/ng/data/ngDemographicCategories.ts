import type { DemographicCategory } from "@/lib/db/types";

/**
 * Nigeria Voter Archetypes — 8 mutually-exclusive attitudinal/demographic
 * groups covering the contemporary Nigerian political landscape.
 *
 * Design principle: each archetype is defined by attitudes and demographics,
 * not geography or party affiliation. Every group can exist in every
 * geo-political zone; regional character is expressed through population
 * percentages in ngRegionDemographics.ts.
 *
 * Each group has:
 *   defaultEconomicLean: -5 (far left / redistribution) to +5 (far right / markets)
 *   defaultSocialLean:   -5 (progressive / liberal) to +5 (traditional / conservative)
 *   defaultTurnout:      baseline participation rate (Nigerian INEC avg ~35-50%;
 *                        significantly lower than Brazil's compulsory system)
 *
 * demographicProfileId: "ng_voterGroups"
 */
export const NG_VOTER_GROUP_BASELINES: Record<string, number> = {
  northern_muslim_conservative: 45,
  yoruba_moderate: 55,
  igbo_business: 60,
  niger_delta_youth: 50,
  christian_conservative: 50,
  urban_young_progressive: 40,
  rural_agrarian: 35,
  lagos_cosmopolitan: 55,
};

export const ngDemographicCategories: DemographicCategory[] = [
  {
    _id: "ng_voterGroups",
    name: "Nigeria Voter Groups",
    defaultWeight: 100,
    groups: [
      /**
       * Northern Muslim Conservative
       * Hausa-Fulani core; Kaduna/Kano/Sokoto caliphate heartland; CPC/ANPP
       * legacy now APC base. Strongly traditional on religion, family, and
       * law (sharia in 12 northern states). Economically pragmatic — supports
       * federal redistribution and subsidy politics. Dominant across the
       * North-West and North-East.
       */
      {
        id: "northern_muslim_conservative",
        name: "Northern Muslim Conservative",
        defaultEconomicLean: 2,
        defaultSocialLean: 3,
        defaultTurnout: 45,
      },
      /**
       * Yoruba Moderate
       * South-West Yoruba bloc; Action Group/UPN/AD/ACN lineage. Pragmatic
       * market-oriented centre; highly educated; Lagos, Ogun, Oyo federal
       * workforce and professional class. Socially centrist; swings between
       * APC and PDP based on candidate and Yoruba ethnoregional calculus.
       */
      {
        id: "yoruba_moderate",
        name: "Yoruba Moderate",
        defaultEconomicLean: 0,
        defaultSocialLean: 0,
        defaultTurnout: 55,
      },
      /**
       * Igbo Business
       * South-East Igbo commercial class; APGA/Ohanaeze heartland; trading,
       * import-export, manufacturing entrepreneurs. Pro-market, low-tax,
       * pro-privatisation. Socially moderate-to-liberal; strong sense of
       * marginalisation from federal centre; historically PDP but volatile.
       */
      {
        id: "igbo_business",
        name: "Igbo Business",
        defaultEconomicLean: 1,
        defaultSocialLean: -1,
        defaultTurnout: 60,
      },
      /**
       * Niger Delta Youth
       * South-South minority nationalities; Ijaw, Ogoni, Efik, Ibibio. Resource-
       * control politics; PDP legacy through Jonathan; militant-amnesty
       * networks; environmental grievance against oil majors. Economically left
       * on resource redistribution; socially mixed. Volatile, low trust in
       * federal centre.
       */
      {
        id: "niger_delta_youth",
        name: "Niger Delta Youth",
        defaultEconomicLean: -2,
        defaultSocialLean: -1,
        defaultTurnout: 50,
      },
      /**
       * Christian Conservative
       * Middle Belt and southern Christian bloc; CAN/PFN networks. Socially
       * traditional on family, sexuality, and education. Economically mixed —
       * pro-redistribution in Middle Belt but market-oriented in Lagos
       * congregations. Cross-cutting North-Central and southern rural zones.
       */
      {
        id: "christian_conservative",
        name: "Christian Conservative",
        defaultEconomicLean: 1,
        defaultSocialLean: 2,
        defaultTurnout: 50,
      },
      /**
       * Urban Young Progressive
       * Lagos/Abuja/Port Harcourt university youth; #EndSARS generation;
       * social-media activism; labour, climate, and gender justice networks.
       * Economically redistributionist; socially progressive. Volatile
       * turnout — peaks around youth-mobilisation cycles.
       */
      {
        id: "urban_young_progressive",
        name: "Urban Young Progressive",
        defaultEconomicLean: -2,
        defaultSocialLean: -2,
        defaultTurnout: 40,
      },
      /**
       * Rural Agrarian
       * Northern and Middle Belt smallholders; subsistence agriculture;
       * lowest education and income; weak party attachment; votes along
       * patronage and ethno-religious lines. Socially traditional;
       * economically pro-subsidy and pro-transfer.
       */
      {
        id: "rural_agrarian",
        name: "Rural Agrarian",
        defaultEconomicLean: 1,
        defaultSocialLean: 1,
        defaultTurnout: 35,
      },
      /**
       * Lagos Cosmopolitan
       * Lagos Island/Victoria Island/Ikeja GRA professionals; finance, tech,
       * media, and diaspora-returnee class. Market liberal, fiscally
       * conservative, socially liberal. High turnout in Lagos State; weak
       * party loyalty — mobilises around competence and credibility.
       */
      {
        id: "lagos_cosmopolitan",
        name: "Lagos Cosmopolitan",
        defaultEconomicLean: 0,
        defaultSocialLean: -1,
        defaultTurnout: 55,
      },
    ],
  },
];
