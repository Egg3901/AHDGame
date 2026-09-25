/**
 * Sweden's 31 December 1990 county population, used at the January 1991
 * world start. SCB's historical series reports counties on its harmonized
 * boundaries; all 21 county rows below sum exactly to the national row.
 * Source: Statistics Sweden, BE0101N1, year 1990, all marital statuses and
 * both sexes, age total:
 * https://www.statistikdatabasen.scb.se/pxweb/en/ssd/START__BE__BE0101__BE0101A/BefolkningNy/
 */
export const SE_1990_COUNTY_POPULATION = {
  Stockholm: 1_641_669,
  Uppsala: 268_835,
  Sodermanland: 255_636,
  Ostergotland: 403_011,
  Jonkoping: 325_163,
  Kronoberg: 177_882,
  Kalmar: 241_102,
  Gotland: 57_108,
  Blekinge: 150_564,
  Skane: 1_068_587,
  Halland: 254_725,
  VastraGotaland: 1_441_293,
  Varmland: 283_110,
  Orebro: 272_513,
  Vastmanland: 258_487,
  Dalarna: 289_067,
  Gavleborg: 289_294,
  Vasternorrland: 261_155,
  Jamtland: 135_726,
  Vasterbotten: 251_968,
  Norrbotten: 263_735,
} as const;

type County = keyof typeof SE_1990_COUNTY_POPULATION;

export const SE_1991_MACROREGION_COUNTIES = {
  SE_STH: ["Stockholm"],
  SE_GOT: ["VastraGotaland", "Halland"],
  SE_SKA: ["Skane", "Blekinge"],
  SE_EAS: ["Ostergotland", "Sodermanland", "Gotland"],
  SE_SML: ["Jonkoping", "Kronoberg", "Kalmar"],
  SE_VML: ["Orebro", "Vastmanland", "Varmland", "Dalarna"],
  SE_NOR: ["Gavleborg", "Vasternorrland", "Jamtland", "Vasterbotten", "Norrbotten"],
  SE_UPP: ["Uppsala"],
} as const satisfies Record<string, readonly County[]>;

export const SE_1991_MACROREGION_POPULATION = Object.fromEntries(
  Object.entries(SE_1991_MACROREGION_COUNTIES).map(([id, counties]) => [
    id,
    counties.reduce<number>((sum, county) => sum + SE_1990_COUNTY_POPULATION[county], 0),
  ])
) as Record<keyof typeof SE_1991_MACROREGION_COUNTIES, number>;
