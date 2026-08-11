/**
 * China Region Census Profiles — 2007 (WTO boom peak).
 *
 * 2007-default companion to {@link cnRegionCensusData} (the 2019 profiles).
 *
 * Era anchor: 2005 1%-sample population survey (NBS), read forward to 2007.
 * Every value below is independently authored from historical knowledge of
 * each macro-region in that year — NOT derived by scaling any other era's file.
 *
 * Era character: ~45% urban nationally at the peak of the WTO export boom;
 * the largest migration in human history is flowing from the central and
 * southwestern hinterland to Guangdong, Zhejiang, Jiangsu and Shanghai;
 * the 1999 university enrollment expansion is starting to show in young-adult
 * attainment; the Northeast has stabilized after xiagang but lags the coast.
 * Income uses era-neutral relative tiers (no RMB thresholds).
 */

import type { CNRegionLayer1 } from "./cnRegionCensusData";

export const cnRegionCensusData2007: Record<string, CNRegionLayer1> = {
  // Dongbei (Northeast) — post-restructuring stabilization under the 2003
  // "Revitalize the Northeast" program; urban by legacy, aging fastest.
  DB: {
    ethnicity: { han: 92, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 7 },
    age: { young: 21, mid: 29, mature: 35, senior: 15 },
    education: { primary_or_below: 24, secondary: 52, vocational: 13, university: 11 },
    income: { low: 40, middle: 49, high: 11 },
    urbanization: { urban: 55, suburban: 17, rural: 28 },
  },
  // Huabei (North) — Beijing Olympics construction boom; Tianjin Binhai zone;
  // Shanxi riding the coal supercycle.
  HB: {
    ethnicity: { han: 92, zhuang: 0, hui: 2, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 22, mid: 29, mature: 34, senior: 15 },
    education: { primary_or_below: 24, secondary: 50, vocational: 13, university: 13 },
    income: { low: 36, middle: 49, high: 15 },
    urbanization: { urban: 52, suburban: 17, rural: 31 },
  },
  // Huadong (East) — Yangtze delta at full WTO throttle: Shanghai finance,
  // Suzhou electronics, Zhejiang private manufacturing; migrant inflows.
  HD: {
    ethnicity: { han: 99, zhuang: 0, hui: 0, uyghur: 0, tibetan: 0, other_minority: 1 },
    age: { young: 23, mid: 30, mature: 32, senior: 15 },
    education: { primary_or_below: 22, secondary: 50, vocational: 14, university: 14 },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 56, suburban: 18, rural: 26 },
  },
  // Huazhong (Central) — peak labor-export era: left-behind children and
  // elderly skew the resident pyramid; "Rise of Central China" plan is new.
  HZ: {
    ethnicity: { han: 97, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 2 },
    age: { young: 23, mid: 29, mature: 32, senior: 16 },
    education: { primary_or_below: 30, secondary: 50, vocational: 11, university: 9 },
    income: { low: 44, middle: 47, high: 9 },
    urbanization: { urban: 38, suburban: 17, rural: 45 },
  },
  // Huanan (South) — Guangdong is the world's factory floor; tens of millions
  // of young migrants make this the youngest region. Zhuang share in Guangxi.
  HN: {
    ethnicity: { han: 80, zhuang: 14, hui: 0, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 26, mid: 31, mature: 29, senior: 14 },
    education: { primary_or_below: 28, secondary: 50, vocational: 13, university: 9 },
    income: { low: 38, middle: 50, high: 12 },
    urbanization: { urban: 52, suburban: 19, rural: 29 },
  },
  // Xinan (Southwest) — Chongqing municipality growing fast but Yunnan,
  // Guizhou and Tibet remain China's most rural, least-schooled areas.
  XN: {
    ethnicity: { han: 78, zhuang: 2, hui: 1, uyghur: 0, tibetan: 8, other_minority: 11 },
    age: { young: 24, mid: 28, mature: 32, senior: 16 },
    education: { primary_or_below: 42, secondary: 44, vocational: 8, university: 6 },
    income: { low: 52, middle: 41, high: 7 },
    urbanization: { urban: 32, suburban: 15, rural: 53 },
  },
  // Xibei (Northwest) — Western Development investment in roads and energy;
  // Xinjiang's Uyghur share near its modern peak before later Han inflows.
  XB: {
    ethnicity: { han: 60, zhuang: 0, hui: 14, uyghur: 18, tibetan: 4, other_minority: 4 },
    age: { young: 26, mid: 29, mature: 30, senior: 15 },
    education: { primary_or_below: 38, secondary: 44, vocational: 10, university: 8 },
    income: { low: 50, middle: 42, high: 8 },
    urbanization: { urban: 38, suburban: 16, rural: 46 },
  },
};
