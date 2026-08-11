/**
 * China Region Census Profiles — 1953 era (early PRC).
 *
 * 1953-default companion to {@link cnRegionCensusData} (the 2019 profiles).
 * Anchored on the 1953 National Population Census of the PRC (the first ever
 * conducted in China), reported by NBS in 1954.
 *
 * Era anchors (first Five-Year Plan / Korean War ending): 89% of the
 * population was rural (NBS 1953); per-capita GDP was approximately USD 50
 * in current dollars (one of the lowest in the world); the Korean War ended
 * July 1953; land reform (collectivisation) was beginning but communes had
 * not yet been formed (Great Leap Forward not until 1958); university
 * enrolment was tiny (~90,000 students nationally = <0.5% of adults);
 * education was devastated by a century of conflict — 80%+ of adults had
 * primary school or less; the Cultural Revolution had not yet happened so
 * this is the starting point, not the nadir. Income is heavily compressed
 * around subsistence; there was no meaningful middle class yet. All tiers
 * are era-neutral relative values.
 */

import type { CNRegionLayer1 } from "./cnRegionCensusData";

export const cnRegionCensusData1953: Record<string, CNRegionLayer1> = {
  // Dongbei — Soviet-aided Anshan steel, Fushun coal; most urban region.
  DB: {
    ethnicity: { han: 92, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 7 },
    age: { young: 34, mid: 28, mature: 27, senior: 11 },
    education: { primary_or_below: 74, secondary: 23, vocational: 2, university: 1 },
    income: { low: 70, middle: 27, high: 3 },
    urbanization: { urban: 26, suburban: 12, rural: 62 },
  },
  // Huabei — Beijing/Tianjin; grain-belt Hebei; Inner Mongolia; Shanxi coal.
  HB: {
    ethnicity: { han: 93, zhuang: 0, hui: 2, uyghur: 0, tibetan: 0, other_minority: 5 },
    age: { young: 33, mid: 28, mature: 27, senior: 12 },
    education: { primary_or_below: 76, secondary: 21, vocational: 2, university: 1 },
    income: { low: 74, middle: 23, high: 3 },
    urbanization: { urban: 16, suburban: 10, rural: 74 },
  },
  // Huadong — Shanghai (the former commercial hub, now nationalised);
  // Jiangsu/Zhejiang/Anhui rice paddy countryside.
  HD: {
    ethnicity: { han: 99, zhuang: 0, hui: 0, uyghur: 0, tibetan: 0, other_minority: 1 },
    age: { young: 32, mid: 28, mature: 28, senior: 12 },
    education: { primary_or_below: 74, secondary: 23, vocational: 2, university: 1 },
    income: { low: 68, middle: 29, high: 3 },
    urbanization: { urban: 14, suburban: 12, rural: 74 },
  },
  // Huazhong — Henan/Hubei/Hunan grain heartland; deepest countryside.
  HZ: {
    ethnicity: { han: 97, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 2 },
    age: { young: 34, mid: 28, mature: 26, senior: 12 },
    education: { primary_or_below: 80, secondary: 18, vocational: 1, university: 1 },
    income: { low: 78, middle: 20, high: 2 },
    urbanization: { urban: 8, suburban: 9, rural: 83 },
  },
  // Huanan — Guangdong (Canton); Guangxi Zhuang areas; pre-SEZ fishing towns.
  HN: {
    ethnicity: { han: 79, zhuang: 15, hui: 0, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 35, mid: 27, mature: 27, senior: 11 },
    education: { primary_or_below: 80, secondary: 18, vocational: 1, university: 1 },
    income: { low: 74, middle: 24, high: 2 },
    urbanization: { urban: 9, suburban: 10, rural: 81 },
  },
  // Xinan — Sichuan/Yunnan/Guizhou/Tibet; most impoverished; many minorities.
  XN: {
    ethnicity: { han: 79, zhuang: 2, hui: 2, uyghur: 0, tibetan: 9, other_minority: 8 },
    age: { young: 35, mid: 27, mature: 26, senior: 12 },
    education: { primary_or_below: 86, secondary: 12, vocational: 1, university: 1 },
    income: { low: 82, middle: 16, high: 2 },
    urbanization: { urban: 5, suburban: 8, rural: 87 },
  },
  // Xibei — Xinjiang/Gansu/Qinghai; Uyghur and Hui majority in many areas.
  XB: {
    ethnicity: { han: 58, zhuang: 0, hui: 14, uyghur: 20, tibetan: 4, other_minority: 4 },
    age: { young: 35, mid: 27, mature: 27, senior: 11 },
    education: { primary_or_below: 84, secondary: 14, vocational: 1, university: 1 },
    income: { low: 80, middle: 18, high: 2 },
    urbanization: { urban: 8, suburban: 9, rural: 83 },
  },
};
