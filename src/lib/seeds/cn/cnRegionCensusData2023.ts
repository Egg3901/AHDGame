/**
 * China Region Census Profiles — 2023 (post-COVID, peak-population China).
 *
 * 2023-default companion to {@link cnRegionCensusData} (the 2019 profiles).
 *
 * Era anchor: 2020 National Population Census (NBS), read forward to 2023.
 * Every value below is independently authored from historical knowledge of
 * each macro-region in that year — NOT derived by scaling any other era's file.
 *
 * Era character: ~66% urban nationally; national population has peaked and
 * begun to decline; the one-child cohort structure produces a heavy senior
 * share, most extreme in the Northeast where decades of out-migration and
 * rock-bottom fertility compound it; higher-ed massification means roughly a
 * quarter of coastal adults hold degrees; record graduate unemployment amid
 * the property slump. Income uses era-neutral relative tiers.
 */

import type { CNRegionLayer1 } from "./cnRegionCensusData";

export const cnRegionCensusData2023: Record<string, CNRegionLayer1> = {
  // Dongbei (Northeast) — demographic crisis zone: lowest fertility in China,
  // sustained youth out-migration, oldest age structure of any region.
  DB: {
    ethnicity: { han: 92, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 7 },
    age: { young: 15, mid: 24, mature: 37, senior: 24 },
    education: { primary_or_below: 16, secondary: 48, vocational: 17, university: 19 },
    income: { low: 32, middle: 52, high: 16 },
    urbanization: { urban: 68, suburban: 16, rural: 16 },
  },
  // Huabei (North) — Beijing caps its population while Xiong'an and Tianjin
  // absorb spillover; Shanxi diversifying off coal.
  HB: {
    ethnicity: { han: 92, zhuang: 0, hui: 2, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 18, mid: 27, mature: 34, senior: 21 },
    education: { primary_or_below: 14, secondary: 44, vocational: 17, university: 25 },
    income: { low: 26, middle: 50, high: 24 },
    urbanization: { urban: 70, suburban: 15, rural: 15 },
  },
  // Huadong (East) — richest region: Shanghai/Hangzhou/Nanjing tech and
  // finance; highest degree share; aging but refreshed by graduate inflows.
  HD: {
    ethnicity: { han: 99, zhuang: 0, hui: 0, uyghur: 0, tibetan: 0, other_minority: 1 },
    age: { young: 18, mid: 28, mature: 33, senior: 21 },
    education: { primary_or_below: 13, secondary: 44, vocational: 17, university: 26 },
    income: { low: 22, middle: 49, high: 29 },
    urbanization: { urban: 74, suburban: 15, rural: 11 },
  },
  // Huazhong (Central) — return-migration era: Zhengzhou/Wuhan/Changsha now
  // retain workers who once left for the coast; countryside aging fast.
  HZ: {
    ethnicity: { han: 97, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 2 },
    age: { young: 19, mid: 27, mature: 33, senior: 21 },
    education: { primary_or_below: 19, secondary: 48, vocational: 16, university: 17 },
    income: { low: 33, middle: 51, high: 16 },
    urbanization: { urban: 62, suburban: 17, rural: 21 },
  },
  // Huanan (South) — Greater Bay Area: Shenzhen tech upgrade keeps Guangdong
  // the youngest region; Guangxi (Zhuang) still lags its rich neighbor.
  HN: {
    ethnicity: { han: 79, zhuang: 15, hui: 0, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 22, mid: 29, mature: 30, senior: 19 },
    education: { primary_or_below: 19, secondary: 46, vocational: 17, university: 18 },
    income: { low: 30, middle: 50, high: 20 },
    urbanization: { urban: 72, suburban: 16, rural: 12 },
  },
  // Xinan (Southwest) — Chengdu-Chongqing twin-city circle booming while
  // rural Yunnan/Guizhou/Tibet stay China's least urban, least schooled.
  XN: {
    ethnicity: { han: 77, zhuang: 2, hui: 1, uyghur: 0, tibetan: 9, other_minority: 11 },
    age: { young: 20, mid: 27, mature: 32, senior: 21 },
    education: { primary_or_below: 28, secondary: 47, vocational: 13, university: 12 },
    income: { low: 40, middle: 48, high: 12 },
    urbanization: { urban: 56, suburban: 15, rural: 29 },
  },
  // Xibei (Northwest) — Xinjiang's Uyghur share per the 2020 census, with a
  // younger minority age profile; Lanzhou/Xi'an-adjacent corridors urbanizing.
  XB: {
    ethnicity: { han: 58, zhuang: 0, hui: 14, uyghur: 19, tibetan: 4, other_minority: 5 },
    age: { young: 22, mid: 28, mature: 30, senior: 20 },
    education: { primary_or_below: 26, secondary: 46, vocational: 14, university: 14 },
    income: { low: 38, middle: 49, high: 13 },
    urbanization: { urban: 58, suburban: 16, rural: 26 },
  },
};
