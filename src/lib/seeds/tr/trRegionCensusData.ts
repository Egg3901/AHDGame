/**
 * Turkey Region Census Profiles — Layer 1 (1979). Turkey is 1979-preset-only here.
 * SEED INDEPENDENCE — authored for ~1979.
 *
 * "ethnicity" captures the Turkish/Kurdish divide (the Kurdish population is
 * concentrated in the east and southeast — politically decisive), alongside the
 * urban-secular / rural-religious gradient via income / education / urbanization.
 * Each dim sums 100.
 */
export interface TRRegionLayer1 {
  ethnicity: { turkish: number; kurdish: number; other: number };
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

export const trRegionCensusData: Record<string, TRRegionLayer1> = {
  TR_IST: {
    ethnicity: { turkish: 92, kurdish: 6, other: 2 },
    age: { young: 36, mid: 30, mature: 20, senior: 14 },
    education: { primary_or_below: 50, secondary: 30, vocational: 12, university: 8 },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 80, suburban: 12, rural: 8 },
  },
  TR_ANK: {
    ethnicity: { turkish: 93, kurdish: 6, other: 1 },
    age: { young: 36, mid: 29, mature: 21, senior: 14 },
    education: { primary_or_below: 46, secondary: 31, vocational: 13, university: 10 },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 70, suburban: 12, rural: 18 },
  },
  TR_IZM: {
    ethnicity: { turkish: 95, kurdish: 3, other: 2 },
    age: { young: 34, mid: 29, mature: 22, senior: 15 },
    education: { primary_or_below: 50, secondary: 31, vocational: 12, university: 7 },
    income: { low: 28, middle: 54, high: 18 },
    urbanization: { urban: 64, suburban: 12, rural: 24 },
  },
  TR_MED: {
    ethnicity: { turkish: 88, kurdish: 10, other: 2 },
    age: { young: 38, mid: 28, mature: 20, senior: 14 },
    education: { primary_or_below: 56, secondary: 28, vocational: 10, university: 6 },
    income: { low: 36, middle: 50, high: 14 },
    urbanization: { urban: 52, suburban: 12, rural: 36 },
  },
  TR_BLA: {
    ethnicity: { turkish: 95, kurdish: 3, other: 2 },
    age: { young: 37, mid: 28, mature: 21, senior: 14 },
    education: { primary_or_below: 58, secondary: 28, vocational: 9, university: 5 },
    income: { low: 38, middle: 50, high: 12 },
    urbanization: { urban: 40, suburban: 12, rural: 48 },
  },
  TR_ESA: {
    ethnicity: { turkish: 60, kurdish: 38, other: 2 },
    age: { young: 42, mid: 28, mature: 18, senior: 12 },
    education: { primary_or_below: 68, secondary: 22, vocational: 6, university: 4 },
    income: { low: 56, middle: 38, high: 6 },
    urbanization: { urban: 36, suburban: 10, rural: 54 },
  },
  TR_SEA: {
    ethnicity: { turkish: 35, kurdish: 63, other: 2 },
    age: { young: 44, mid: 28, mature: 17, senior: 11 },
    education: { primary_or_below: 72, secondary: 20, vocational: 5, university: 3 },
    income: { low: 60, middle: 35, high: 5 },
    urbanization: { urban: 38, suburban: 10, rural: 52 },
  },
  TR_CEN: {
    ethnicity: { turkish: 92, kurdish: 7, other: 1 },
    age: { young: 38, mid: 28, mature: 20, senior: 14 },
    education: { primary_or_below: 58, secondary: 28, vocational: 9, university: 5 },
    income: { low: 40, middle: 50, high: 10 },
    urbanization: { urban: 48, suburban: 12, rural: 40 },
  },
};

export default trRegionCensusData;
