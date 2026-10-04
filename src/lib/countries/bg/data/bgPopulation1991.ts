/**
 * Population at the 4 December 1992 census, the nearest observed regional
 * census to the January 1991 scenario. The 28 territorial rows are aggregated
 * into the game's five historical/geographic macroregions. In 1991 Bulgaria
 * used nine administrative oblasti; these 28 districts are census tabulations,
 * not a claim that they were the 1991 administrative structure.
 * Source: Bulgarian NSI, Statistical Yearbook 1992, Population chapter:
 * https://www.nsi.bg/en/file/17637/God1992.pdf
 * District transcription: https://statoids.com/ubg.html (Population history).
 */
export const BG_1992_DISTRICT_POPULATION = {
  Blagoevgrad: 351_637,
  Burgas: 440_372,
  Dobrich: 232_780,
  Gabrovo: 161_987,
  GradSofiya: 1_190_126,
  Khaskovo: 295_503,
  Kurdzhali: 213_806,
  Kyustendil: 181_347,
  Lovech: 190_262,
  Montana: 208_198,
  Pazardzhik: 326_123,
  Pernik: 163_307,
  Pleven: 346_614,
  Plovdiv: 734_495,
  Razgrad: 167_410,
  Ruse: 288_702,
  Shumen: 220_320,
  Silistra: 161_063,
  Sliven: 234_785,
  Smolyan: 159_752,
  Sofiya: 289_962,
  StaraZagora: 397_339,
  Turgovishte: 151_339,
  Varna: 462_970,
  VelikoTurnovo: 318_251,
  Vidin: 151_636,
  Vratsa: 270_679,
  Yambol: 176_552,
} as const;

type District = keyof typeof BG_1992_DISTRICT_POPULATION;

/** Geographic aggregation; Sofia city and its surrounding district stay together. */
export const BG_1991_MACROREGION_DISTRICTS = {
  BG_SOF: ["GradSofiya", "Sofiya"],
  BG_NOR: [
    "Gabrovo",
    "Lovech",
    "Montana",
    "Pleven",
    "Razgrad",
    "Ruse",
    "Shumen",
    "Silistra",
    "Turgovishte",
    "VelikoTurnovo",
    "Vidin",
    "Vratsa",
  ],
  BG_COA: ["Burgas", "Dobrich", "Varna"],
  BG_THR: [
    "Khaskovo",
    "Kurdzhali",
    "Pazardzhik",
    "Plovdiv",
    "Sliven",
    "Smolyan",
    "StaraZagora",
    "Yambol",
  ],
  BG_SW: ["Blagoevgrad", "Kyustendil", "Pernik"],
} as const satisfies Record<string, readonly District[]>;

export const BG_1991_MACROREGION_POPULATION = Object.fromEntries(
  Object.entries(BG_1991_MACROREGION_DISTRICTS).map(([regionId, districts]) => [
    regionId,
    districts.reduce<number>((sum, district) => sum + BG_1992_DISTRICT_POPULATION[district], 0),
  ])
) as Record<keyof typeof BG_1991_MACROREGION_DISTRICTS, number>;
