/**
 * China Region Census Profiles - 2027 (post-peak-population China).
 *
 * 2027-default companion to {@link cnRegionCensusData2023}. Every value is
 * independently authored for 2027 as a literal, using the 2023 bundle as the
 * visible base plus the documented projection assumptions below. This file
 * does not import or scale any other era file.
 *
 * Base: 2023 bundle (2020 National Population Census read forward to 2023).
 * Projection assumptions 2023 to 2027:
 * - Urban share rises 2 points in every region (NBS: urbanization passes
 *   66 pct nationally and keeps climbing about 1 point per year). Rural
 *   falls to compensate; suburban mostly flat.
 * - Senior share rises 2 points in every region (2022 to 2026 natural
 *   decrease about 2 million per year; one-child cohort structure plus
 *   record-low births). Young and mid fall to compensate.
 * - University share rises 1 point (higher-ed massification continues).
 *   Primary-or-below and secondary fall to compensate.
 * - Ethnic composition and relative income tiers are held at 2023 values
 *   (broadly stable per NBS nationality groupings over short horizons).
 *
 * Sources:
 * https://www.stats.gov.cn/english/ (NBS statistical communiques)
 * https://data.stats.gov.cn/ (NBS national data portal)
 */
import type { CNRegionLayer1 } from "./cnRegionCensusData";

export const cnRegionCensusData2027: Record<string, CNRegionLayer1> = {
  // Dongbei - oldest age structure nationally; youth out-migration continues.
  DB: {
    ethnicity: { han: 92, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 7 },
    age: { young: 14, mid: 23, mature: 37, senior: 26 },
    education: { primary_or_below: 15, secondary: 47, vocational: 18, university: 20 },
    income: { low: 32, middle: 52, high: 16 },
    urbanization: { urban: 70, suburban: 15, rural: 15 },
  },
  // Huabei - Beijing caps population; Xiong'an and Tianjin absorb spillover.
  HB: {
    ethnicity: { han: 92, zhuang: 0, hui: 2, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 17, mid: 26, mature: 34, senior: 23 },
    education: { primary_or_below: 13, secondary: 43, vocational: 18, university: 26 },
    income: { low: 26, middle: 50, high: 24 },
    urbanization: { urban: 72, suburban: 14, rural: 14 },
  },
  // Huadong - richest region; highest degree share; graduate inflows refresh.
  HD: {
    ethnicity: { han: 99, zhuang: 0, hui: 0, uyghur: 0, tibetan: 0, other_minority: 1 },
    age: { young: 17, mid: 27, mature: 33, senior: 23 },
    education: { primary_or_below: 12, secondary: 43, vocational: 18, university: 27 },
    income: { low: 22, middle: 49, high: 29 },
    urbanization: { urban: 76, suburban: 14, rural: 10 },
  },
  // Huazhong - return migration to Zhengzhou, Wuhan, Changsha continues.
  HZ: {
    ethnicity: { han: 97, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 2 },
    age: { young: 18, mid: 26, mature: 33, senior: 23 },
    education: { primary_or_below: 18, secondary: 47, vocational: 17, university: 18 },
    income: { low: 33, middle: 51, high: 16 },
    urbanization: { urban: 64, suburban: 16, rural: 20 },
  },
  // Huanan - Greater Bay Area keeps Guangdong the youngest region.
  HN: {
    ethnicity: { han: 79, zhuang: 15, hui: 0, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 21, mid: 28, mature: 30, senior: 21 },
    education: { primary_or_below: 18, secondary: 45, vocational: 18, university: 19 },
    income: { low: 30, middle: 50, high: 20 },
    urbanization: { urban: 74, suburban: 15, rural: 11 },
  },
  // Xinan - Chengdu-Chongqing circle booms; rural west stays least schooled.
  XN: {
    ethnicity: { han: 77, zhuang: 2, hui: 1, uyghur: 0, tibetan: 9, other_minority: 11 },
    age: { young: 19, mid: 26, mature: 32, senior: 23 },
    education: { primary_or_below: 27, secondary: 46, vocational: 14, university: 13 },
    income: { low: 40, middle: 48, high: 12 },
    urbanization: { urban: 58, suburban: 15, rural: 27 },
  },
  // Xibei - younger minority age profile; corridor urbanization continues.
  XB: {
    ethnicity: { han: 58, zhuang: 0, hui: 14, uyghur: 19, tibetan: 4, other_minority: 5 },
    age: { young: 21, mid: 27, mature: 30, senior: 22 },
    education: { primary_or_below: 25, secondary: 45, vocational: 15, university: 15 },
    income: { low: 38, middle: 49, high: 13 },
    urbanization: { urban: 60, suburban: 15, rural: 25 },
  },
};

export default cnRegionCensusData2027;
