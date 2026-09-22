/**
 * China Region Census Profiles — Layer 1 demographic breakdown per macro-region.
 * Mirrors the structure of the UK/JP/DE census files.
 *
 * This module owns the {@link CNRegionLayer1} shape. The `2019-default`
 * profiles below are authored in a later task; the `1991-default` companion
 * lives in `cnRegionCensusData1991.ts`. The preset registry selects between
 * them at render time.
 *
 * Ethnicity uses the Han majority plus the largest named nationalities
 * (Zhuang, Hui, Uyghur, Tibetan) and an aggregated `other_minority` bucket
 * (Manchu, Mongol, Korean, Yi, Miao, etc.) — neutral demographic groupings.
 *
 * Fields (% of adult population):
 *   ethnicity    — NBS census nationality (民族) groupings
 *   age          — Adult (18+) distribution
 *   education    — Highest level of schooling completed
 *   income       — Relative household-income tiers (era-neutral)
 *   urbanization — Urban / county-town / rural split
 */

export interface CNRegionLayer1 {
  ethnicity: {
    han: number;
    zhuang: number;
    hui: number;
    uyghur: number;
    tibetan: number;
    other_minority: number;
  };
  age: { young: number; mid: number; mature: number; senior: number };
  education: {
    primary_or_below: number;
    secondary: number;
    vocational: number;
    university: number;
  };
  income: { low: number; middle: number; high: number };
  urbanization: { urban: number; suburban: number; rural: number };
}

/**
 * 2019-default (modern) profiles — approximate 2020 census (NBS) estimates
 * (% of adult population). Keys stay in sync with {@link cnRegionCensusData1991}
 * and `REGION_CENSUS_LABELS.CN`.
 *
 * Directional vs the 1991 profiles: far higher urbanization, higher university
 * attainment, higher upper-income share, and an older age structure (one-child
 * policy). Ethnic composition is broadly stable per region.
 */
export const cnRegionCensusData: Record<string, CNRegionLayer1> = {
  DB: {
    ethnicity: { han: 92, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 7 },
    age: { young: 18, mid: 26, mature: 36, senior: 20 },
    education: { primary_or_below: 18, secondary: 50, vocational: 16, university: 16 },
    income: { low: 32, middle: 52, high: 16 },
    urbanization: { urban: 65, suburban: 17, rural: 18 },
  },
  HB: {
    ethnicity: { han: 92, zhuang: 0, hui: 2, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 19, mid: 28, mature: 34, senior: 19 },
    education: { primary_or_below: 16, secondary: 46, vocational: 16, university: 22 },
    income: { low: 28, middle: 50, high: 22 },
    urbanization: { urban: 68, suburban: 16, rural: 16 },
  },
  HD: {
    ethnicity: { han: 99, zhuang: 0, hui: 0, uyghur: 0, tibetan: 0, other_minority: 1 },
    age: { young: 19, mid: 29, mature: 33, senior: 19 },
    education: { primary_or_below: 15, secondary: 46, vocational: 17, university: 22 },
    income: { low: 24, middle: 50, high: 26 },
    urbanization: { urban: 72, suburban: 16, rural: 12 },
  },
  HZ: {
    ethnicity: { han: 97, zhuang: 0, hui: 1, uyghur: 0, tibetan: 0, other_minority: 2 },
    age: { young: 20, mid: 28, mature: 33, senior: 19 },
    education: { primary_or_below: 22, secondary: 50, vocational: 14, university: 14 },
    income: { low: 36, middle: 50, high: 14 },
    urbanization: { urban: 58, suburban: 18, rural: 24 },
  },
  HN: {
    ethnicity: { han: 80, zhuang: 14, hui: 0, uyghur: 0, tibetan: 0, other_minority: 6 },
    age: { young: 22, mid: 29, mature: 31, senior: 18 },
    education: { primary_or_below: 22, secondary: 48, vocational: 16, university: 14 },
    income: { low: 32, middle: 50, high: 18 },
    urbanization: { urban: 68, suburban: 18, rural: 14 },
  },
  XN: {
    ethnicity: { han: 78, zhuang: 2, hui: 1, uyghur: 0, tibetan: 8, other_minority: 11 },
    age: { young: 21, mid: 28, mature: 32, senior: 19 },
    education: { primary_or_below: 32, secondary: 48, vocational: 11, university: 9 },
    income: { low: 42, middle: 47, high: 11 },
    urbanization: { urban: 52, suburban: 16, rural: 32 },
  },
  XB: {
    ethnicity: { han: 60, zhuang: 0, hui: 14, uyghur: 18, tibetan: 4, other_minority: 4 },
    age: { young: 23, mid: 29, mature: 30, senior: 18 },
    education: { primary_or_below: 30, secondary: 47, vocational: 12, university: 11 },
    income: { low: 40, middle: 48, high: 12 },
    urbanization: { urban: 54, suburban: 17, rural: 29 },
  },
};
