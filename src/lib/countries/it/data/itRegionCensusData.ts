/**
 * Italy Region Census Profiles — Layer 1 (1979). Italy is 1979-preset-only here.
 * SEED INDEPENDENCE — authored for ~1979. Italy was ethnically homogeneous in
 * 1979; the politically decisive axis is the industrial North ↔ agrarian South
 * divide, captured through income / education / urbanization. Each dim sums 100.
 */
export interface ITRegionLayer1 {
  ethnicity: { italian: number; immigrant: number; other: number };
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

export const itRegionCensusData: Record<string, ITRegionLayer1> = {
  IT_NW: {
    ethnicity: { italian: 95, immigrant: 4, other: 1 },
    age: { young: 28, mid: 28, mature: 25, senior: 19 },
    education: { primary_or_below: 40, secondary: 36, vocational: 16, university: 8 },
    income: { low: 20, middle: 56, high: 24 },
    urbanization: { urban: 78, suburban: 12, rural: 10 },
  },
  IT_NE: {
    ethnicity: { italian: 96, immigrant: 3, other: 1 },
    age: { young: 28, mid: 28, mature: 25, senior: 19 },
    education: { primary_or_below: 42, secondary: 35, vocational: 16, university: 7 },
    income: { low: 22, middle: 58, high: 20 },
    urbanization: { urban: 66, suburban: 14, rural: 20 },
  },
  IT_TUS: {
    ethnicity: { italian: 97, immigrant: 2, other: 1 },
    age: { young: 26, mid: 27, mature: 25, senior: 22 },
    education: { primary_or_below: 44, secondary: 34, vocational: 15, university: 7 },
    income: { low: 24, middle: 58, high: 18 },
    urbanization: { urban: 64, suburban: 14, rural: 22 },
  },
  IT_LAZ: {
    ethnicity: { italian: 93, immigrant: 6, other: 1 },
    age: { young: 29, mid: 29, mature: 24, senior: 18 },
    education: { primary_or_below: 38, secondary: 38, vocational: 15, university: 9 },
    income: { low: 24, middle: 56, high: 20 },
    urbanization: { urban: 82, suburban: 10, rural: 8 },
  },
  IT_CAM: {
    ethnicity: { italian: 97, immigrant: 2, other: 1 },
    age: { young: 34, mid: 28, mature: 22, senior: 16 },
    education: { primary_or_below: 50, secondary: 32, vocational: 12, university: 6 },
    income: { low: 36, middle: 52, high: 12 },
    urbanization: { urban: 70, suburban: 12, rural: 18 },
  },
  IT_SUD: {
    ethnicity: { italian: 98, immigrant: 1, other: 1 },
    age: { young: 32, mid: 27, mature: 23, senior: 18 },
    education: { primary_or_below: 54, secondary: 30, vocational: 11, university: 5 },
    income: { low: 40, middle: 50, high: 10 },
    urbanization: { urban: 52, suburban: 12, rural: 36 },
  },
  IT_SIC: {
    ethnicity: { italian: 98, immigrant: 1, other: 1 },
    age: { young: 32, mid: 27, mature: 23, senior: 18 },
    education: { primary_or_below: 54, secondary: 30, vocational: 11, university: 5 },
    income: { low: 42, middle: 48, high: 10 },
    urbanization: { urban: 56, suburban: 12, rural: 32 },
  },
  IT_SAR: {
    ethnicity: { italian: 98, immigrant: 1, other: 1 },
    age: { young: 31, mid: 27, mature: 23, senior: 19 },
    education: { primary_or_below: 52, secondary: 31, vocational: 12, university: 5 },
    income: { low: 38, middle: 52, high: 10 },
    urbanization: { urban: 54, suburban: 12, rural: 34 },
  },
};

export default itRegionCensusData;
