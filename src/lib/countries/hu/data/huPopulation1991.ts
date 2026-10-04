/**
 * Hungarian population immediately before the January 1991 scenario.
 * KSH, "Resident population by territorial unit and age group, 1 January
 * 1990". The statistical regions aggregate contemporary counties; the game
 * combines Central and Western Transdanubia, and both Great Plain regions.
 * Source: https://www.ksh.hu/docs/hun/xtabla/oregedes/tablto09_04.html
 * The source's total is 10,374,823, within 0.02% of WDI's 1991 10,373,400.
 */
export const HU_1991_REGION_AGE = {
  HU_BUD: { young0to14: 351_274, adult15to64: 1_349_403, senior65Plus: 316_097 },
  HU_PES: { young0to14: 199_825, adult15to64: 635_691, senior65Plus: 114_233 },
  HU_TRW: {
    young0to14: 245_698 + 209_944,
    adult15to64: 749_027 + 662_976,
    senior65Plus: 123_264 + 133_861,
  },
  HU_TRS: { young0to14: 207_250, adult15to64: 678_102, senior65Plus: 131_673 },
  HU_NOR: { young0to14: 282_709, adult15to64: 871_677, senior65Plus: 169_122 },
  HU_ALF: {
    young0to14: 352_482 + 281_367,
    adult15to64: 1_008_856 + 914_620,
    senior65Plus: 186_182 + 199_490,
  },
} as const;

export const HU_1991_REGION_POPULATION = Object.fromEntries(
  Object.entries(HU_1991_REGION_AGE).map(([regionId, age]) => [
    regionId,
    age.young0to14 + age.adult15to64 + age.senior65Plus,
  ])
) as Record<keyof typeof HU_1991_REGION_AGE, number>;
