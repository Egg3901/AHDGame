/**
 * Union-republic reference for the January 1991 opening world. The latest
 * complete pre-start table reports population on 1 January 1990 and each
 * republic's share of Soviet net material product in 1988. These are dated
 * source anchors, not observed 1991 GDP or independent-country populations.
 * The 1991 RSFSR regional census is separately authored in ruPopulation1991.
 *
 * World Bank, Joint Study of the Soviet Economy, table 1 and table 2, from
 * Soviet authority data:
 * https://thedocs.worldbank.org/en/doc/571751632222790357-0560011991/original/WorldBankGroupArchivesFolder30382302.pdf
 */
export const SOVIET_REPUBLIC_REFERENCE_1990 = {
  RU: { name: "Russian SFSR", population: 148_041_000, nmpShareBps: 6_110 },
  UKR: { name: "Ukrainian SSR", population: 51_839_000, nmpShareBps: 1_630 },
  BLR: { name: "Byelorussian SSR", population: 10_259_000, nmpShareBps: 420 },
  EE: { name: "Estonian SSR", population: 1_583_000, nmpShareBps: 60 },
  LV: { name: "Latvian SSR", population: 2_687_000, nmpShareBps: 110 },
  LT: { name: "Lithuanian SSR", population: 3_723_000, nmpShareBps: 140 },
  MD: { name: "Moldavian SSR", population: 4_362_000, nmpShareBps: 120 },
  GE: { name: "Georgian SSR", population: 5_456_000, nmpShareBps: 160 },
  AM: { name: "Armenian SSR", population: 3_293_000, nmpShareBps: 90 },
  AZ: { name: "Azerbaijan SSR", population: 7_131_000, nmpShareBps: 170 },
  KZ: { name: "Kazakh SSR", population: 16_691_000, nmpShareBps: 430 },
  TM: { name: "Turkmen SSR", population: 3_622_000, nmpShareBps: 70 },
  UZ: { name: "Uzbek SSR", population: 20_322_000, nmpShareBps: 330 },
  TJ: { name: "Tajik SSR", population: 5_248_000, nmpShareBps: 80 },
  KG: { name: "Kyrgyz SSR", population: 4_367_000, nmpShareBps: 80 },
} as const;
