/**
 * China Region Census Profiles — 1991 (early reform era).
 *
 * 1991-default companion to {@link cnRegionCensusData} (the 2019 profiles).
 * Selected at render time via the preset registry under the `1991-default`
 * reset preset.
 *
 * Sources / methodology (approximate, % of adult population): 1990 National
 * Population Census (NBS). Early-reform China was overwhelmingly rural
 * (~26% urban nationally), with very low tertiary attainment and a young age
 * structure. Minority nationalities concentrate by region: Zhuang in Huanan
 * (Guangxi), Uyghur + Hui in Xibei (Xinjiang / Ningxia), Tibetan in Xinan
 * (Tibet). Income uses era-neutral relative tiers (no RMB thresholds).
 *
 * Directional vs the 2019 profiles: far higher rural share, lower university
 * attainment, lower upper-income share — strongest in the interior (XN/XB/HZ).
 */

import type { CNRegionLayer1 } from "./cnRegionCensusData";

export const cnRegionCensusData1991: Record<string, CNRegionLayer1> = {
  // Dongbei (Northeast) — heavy-industry rust belt, comparatively urban,
  // Han-dominant with Manchu / Korean / Mongol minorities (other_minority).
  DB: {
    ethnicity: { han: 92, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 7 },
    age: { young: 28, mid: 28, mature: 30, senior: 14 },
    education: { primary_or_below: 44, secondary: 46, vocational: 6, university: 4 },
    income: { low: 52, middle: 42, high: 6 },
    urbanization: { urban: 42, suburban: 18, rural: 40 },
  },
  // Huabei (North) — Beijing/Tianjin/Hebei/Shanxi/Inner Mongolia.
  HB: {
    ethnicity: { han: 92, zhuang: 0, hui: 2, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 29, mid: 27, mature: 30, senior: 14 },
    education: { primary_or_below: 48, secondary: 44, vocational: 5, university: 3 },
    income: { low: 55, middle: 40, high: 5 },
    urbanization: { urban: 36, suburban: 16, rural: 48 },
  },
  // Huadong (East) — Shanghai/Jiangsu/Zhejiang/etc., most developed, Han.
  HD: {
    ethnicity: { han: 99, zhuang: 0, hui: 0, uyghur: 0, tibetan: 0, other_minority: 1 },
    age: { young: 28, mid: 28, mature: 30, senior: 14 },
    education: { primary_or_below: 46, secondary: 46, vocational: 5, university: 3 },
    income: { low: 48, middle: 45, high: 7 },
    urbanization: { urban: 38, suburban: 18, rural: 44 },
  },
  // Huazhong (Central) — Henan/Hubei/Hunan, Han-dominant, very rural.
  HZ: {
    ethnicity: { han: 97, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 2 },
    age: { young: 30, mid: 27, mature: 29, senior: 14 },
    education: { primary_or_below: 52, secondary: 42, vocational: 4, university: 2 },
    income: { low: 60, middle: 36, high: 4 },
    urbanization: { urban: 24, suburban: 16, rural: 60 },
  },
  // Huanan (South) — Guangdong/Guangxi/Hainan; Guangxi carries the Zhuang share.
  HN: {
    ethnicity: { han: 80, zhuang: 14, hui: 0, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 30, mid: 27, mature: 29, senior: 14 },
    education: { primary_or_below: 54, secondary: 40, vocational: 4, university: 2 },
    income: { low: 55, middle: 40, high: 5 },
    urbanization: { urban: 28, suburban: 18, rural: 54 },
  },
  // Xinan (Southwest) — Sichuan/Yunnan/Guizhou/Tibet; Tibetan + many minorities.
  XN: {
    ethnicity: { han: 78, zhuang: 2, hui: 1, uyghur: 0, tibetan: 8, other_minority: 11 },
    age: { young: 31, mid: 27, mature: 28, senior: 14 },
    education: { primary_or_below: 62, secondary: 33, vocational: 3, university: 2 },
    income: { low: 66, middle: 30, high: 4 },
    urbanization: { urban: 20, suburban: 14, rural: 66 },
  },
  // Xibei (Northwest) — Xinjiang/Ningxia/Gansu/Qinghai; Uyghur + Hui + Tibetan.
  XB: {
    ethnicity: { han: 60, zhuang: 0, hui: 14, uyghur: 18, tibetan: 4, other_minority: 4 },
    age: { young: 31, mid: 28, mature: 27, senior: 14 },
    education: { primary_or_below: 60, secondary: 33, vocational: 4, university: 3 },
    income: { low: 64, middle: 31, high: 5 },
    urbanization: { urban: 26, suburban: 16, rural: 58 },
  },
};
