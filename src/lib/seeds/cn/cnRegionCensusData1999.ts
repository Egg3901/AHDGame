/**
 * China Region Census Profiles — 1999 (SOE reform / coastal export takeoff).
 *
 * 1999-default companion to {@link cnRegionCensusData} (the 2019 profiles).
 *
 * Era anchor: 2000 National Population Census (NBS), read backward to 1999.
 * Every value below is independently authored from historical knowledge of
 * each macro-region in that year — NOT derived by scaling any other era's file.
 *
 * Era character: ~35% urban nationally; Zhu Rongji's SOE restructuring is
 * shedding tens of millions of xiagang workers in the Northeast and North;
 * the coastal export economy (Pearl/Yangtze deltas) is absorbing the first
 * great migrant waves ahead of WTO accession (2001); nine-year compulsory
 * schooling has pushed most adults to junior-secondary, but university
 * massification (1999 enrollment expansion) hasn't yet reached the adult
 * stock. Income uses era-neutral relative tiers (no RMB thresholds).
 */

import type { CNRegionLayer1 } from "./cnRegionCensusData";

export const cnRegionCensusData1999: Record<string, CNRegionLayer1> = {
  // Dongbei (Northeast) — epicenter of xiagang layoffs; still the most urban
  // region by hukou legacy but its danwei middle class is being hollowed out.
  DB: {
    ethnicity: { han: 92, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 7 },
    age: { young: 24, mid: 30, mature: 32, senior: 14 },
    education: { primary_or_below: 32, secondary: 52, vocational: 9, university: 7 },
    income: { low: 50, middle: 42, high: 8 },
    urbanization: { urban: 48, suburban: 17, rural: 35 },
  },
  // Huabei (North) — Beijing/Tianjin services growing while Shanxi coal and
  // Hebei steel towns absorb their own SOE restructuring pain.
  HB: {
    ethnicity: { han: 92, zhuang: 0, hui: 2, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 25, mid: 29, mature: 32, senior: 14 },
    education: { primary_or_below: 34, secondary: 50, vocational: 9, university: 7 },
    income: { low: 46, middle: 45, high: 9 },
    urbanization: { urban: 40, suburban: 16, rural: 44 },
  },
  // Huadong (East) — Yangtze delta export boom building: Shanghai Pudong,
  // Sunan TVE-to-private conversion, Wenzhou entrepreneurs.
  HD: {
    ethnicity: { han: 99, zhuang: 0, hui: 0, uyghur: 0, tibetan: 0, other_minority: 1 },
    age: { young: 25, mid: 30, mature: 31, senior: 14 },
    education: { primary_or_below: 32, secondary: 52, vocational: 9, university: 7 },
    income: { low: 38, middle: 50, high: 12 },
    urbanization: { urban: 44, suburban: 18, rural: 38 },
  },
  // Huazhong (Central) — Henan/Hubei/Hunan: the great labor-exporting
  // hinterland; working-age adults leave for the coasts, villages stay poor.
  HZ: {
    ethnicity: { han: 97, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 2 },
    age: { young: 26, mid: 28, mature: 31, senior: 15 },
    education: { primary_or_below: 40, secondary: 48, vocational: 7, university: 5 },
    income: { low: 52, middle: 42, high: 6 },
    urbanization: { urban: 28, suburban: 16, rural: 56 },
  },
  // Huanan (South) — Guangdong factories pulling in migrants by the million;
  // young in-migrants tilt the age pyramid. Guangxi carries the Zhuang share.
  HN: {
    ethnicity: { han: 80, zhuang: 14, hui: 0, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 27, mid: 30, mature: 29, senior: 14 },
    education: { primary_or_below: 38, secondary: 50, vocational: 8, university: 4 },
    income: { low: 44, middle: 47, high: 9 },
    urbanization: { urban: 38, suburban: 18, rural: 44 },
  },
  // Xinan (Southwest) — Sichuan/Yunnan/Guizhou/Tibet: still the most rural
  // and least-schooled region; Western Development program announced 1999.
  XN: {
    ethnicity: { han: 78, zhuang: 2, hui: 1, uyghur: 0, tibetan: 8, other_minority: 11 },
    age: { young: 27, mid: 28, mature: 30, senior: 15 },
    education: { primary_or_below: 50, secondary: 40, vocational: 6, university: 4 },
    income: { low: 58, middle: 36, high: 6 },
    urbanization: { urban: 24, suburban: 14, rural: 62 },
  },
  // Xibei (Northwest) — Xinjiang cotton/oil and Lanzhou industry; Uyghur and
  // Hui populations growing faster than the Han under minority exemptions.
  XB: {
    ethnicity: { han: 61, zhuang: 0, hui: 14, uyghur: 17, tibetan: 4, other_minority: 4 },
    age: { young: 28, mid: 29, mature: 28, senior: 15 },
    education: { primary_or_below: 46, secondary: 42, vocational: 7, university: 5 },
    income: { low: 56, middle: 37, high: 7 },
    urbanization: { urban: 30, suburban: 16, rural: 54 },
  },
};
