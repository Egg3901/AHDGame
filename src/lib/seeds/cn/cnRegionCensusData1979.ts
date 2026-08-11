/**
 * China Region Census Profiles — 1979 (eve of reform and opening).
 *
 * 1979-default companion to {@link cnRegionCensusData} (the 2019 profiles).
 *
 * Era anchor: 1982 National Population Census (NBS), read backward to 1979.
 * Every value below is independently authored from historical knowledge of
 * each macro-region at the start of Deng's reforms — NOT derived by scaling
 * any other era's file.
 *
 * Era character: overwhelmingly rural agrarian China (~19% urban nationally,
 * with hukou strictly enforced); a very young population from the 1962–1975
 * baby boom, pre-one-child-policy; education devastated by the Cultural
 * Revolution — gaokao only restored in 1977, so university attainment is
 * near-zero everywhere; commune-era income compression with the Northeast
 * (danwei heavy industry) the only region with a meaningful wage class.
 * Income uses era-neutral relative tiers (no RMB thresholds).
 */

import type { CNRegionLayer1 } from "./cnRegionCensusData";

export const cnRegionCensusData1979: Record<string, CNRegionLayer1> = {
  // Dongbei (Northeast) — Maoist showcase: Daqing oil, Anshan steel; the most
  // urban and proletarian region in 1979 China. Manchu/Korean/Mongol minorities.
  DB: {
    ethnicity: { han: 93, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 38, mid: 28, mature: 25, senior: 9 },
    education: { primary_or_below: 62, secondary: 34, vocational: 3, university: 1 },
    income: { low: 62, middle: 34, high: 4 },
    urbanization: { urban: 35, suburban: 14, rural: 51 },
  },
  // Huabei (North) — Beijing/Tianjin ministries and heavy industry amid a vast
  // Hebei/Shanxi/Inner Mongolia countryside still recovering from collectivization.
  HB: {
    ethnicity: { han: 93, zhuang: 0, hui: 2, uyghur: 0, tibetan: 0, other_minority: 5 },
    age: { young: 37, mid: 28, mature: 26, senior: 9 },
    education: { primary_or_below: 66, secondary: 30, vocational: 3, university: 1 },
    income: { low: 64, middle: 32, high: 4 },
    urbanization: { urban: 28, suburban: 13, rural: 59 },
  },
  // Huadong (East) — Shanghai industrial base, but Jiangsu/Zhejiang/Anhui
  // still dense rice-paddy countryside; TVE boom not yet begun.
  HD: {
    ethnicity: { han: 99, zhuang: 0, hui: 0, uyghur: 0, tibetan: 0, other_minority: 1 },
    age: { young: 36, mid: 28, mature: 27, senior: 9 },
    education: { primary_or_below: 64, secondary: 32, vocational: 3, university: 1 },
    income: { low: 60, middle: 36, high: 4 },
    urbanization: { urban: 24, suburban: 14, rural: 62 },
  },
  // Huazhong (Central) — Henan/Hubei/Hunan grain heartland; among the most
  // rural and agrarian regions, household responsibility system just emerging.
  HZ: {
    ethnicity: { han: 97, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 2 },
    age: { young: 38, mid: 27, mature: 26, senior: 9 },
    education: { primary_or_below: 70, secondary: 27, vocational: 2, university: 1 },
    income: { low: 70, middle: 27, high: 3 },
    urbanization: { urban: 16, suburban: 12, rural: 72 },
  },
  // Huanan (South) — Guangdong on the eve of the SEZs (Shenzhen designated
  // 1980, still a fishing town); Guangxi carries the Zhuang nationality.
  HN: {
    ethnicity: { han: 79, zhuang: 15, hui: 0, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 39, mid: 27, mature: 25, senior: 9 },
    education: { primary_or_below: 70, secondary: 27, vocational: 2, university: 1 },
    income: { low: 66, middle: 31, high: 3 },
    urbanization: { urban: 18, suburban: 13, rural: 69 },
  },
  // Xinan (Southwest) — Sichuan (Zhao Ziyang's early rural reforms), Yunnan,
  // Guizhou, Tibet; deepest rural poverty and lowest schooling in China.
  XN: {
    ethnicity: { han: 80, zhuang: 2, hui: 1, uyghur: 0, tibetan: 8, other_minority: 9 },
    age: { young: 40, mid: 27, mature: 24, senior: 9 },
    education: { primary_or_below: 76, secondary: 21, vocational: 2, university: 1 },
    income: { low: 74, middle: 23, high: 3 },
    urbanization: { urban: 13, suburban: 10, rural: 77 },
  },
  // Xibei (Northwest) — Xinjiang bingtuan settlements, Third Front industry in
  // Gansu; Uyghur and Hui populations large, Han in-migration ongoing.
  XB: {
    ethnicity: { han: 62, zhuang: 0, hui: 13, uyghur: 17, tibetan: 4, other_minority: 4 },
    age: { young: 40, mid: 27, mature: 24, senior: 9 },
    education: { primary_or_below: 74, secondary: 22, vocational: 3, university: 1 },
    income: { low: 72, middle: 24, high: 4 },
    urbanization: { urban: 18, suburban: 12, rural: 70 },
  },
};
