/**
 * Sweden Region Census Profiles — Layer 1 (1979, the Swedish model). Sweden is
 * 1979-preset-only here. SEED INDEPENDENCE — authored for ~1979.
 *
 * Sweden was ethnically homogeneous in 1979 (Finnish + Yugoslav labour migrants
 * the main minorities); the decisive axes are urban Stockholm vs the industrial
 * Bergslagen and the rural North, expressed through income / education /
 * urbanization. Each dim sums 100.
 */
export interface SERegionLayer1 {
  ethnicity: { swedish: number; immigrant: number; other: number };
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

export const seRegionCensusData: Record<string, SERegionLayer1> = {
  SE_STH: {
    ethnicity: { swedish: 88, immigrant: 9, other: 3 },
    age: { young: 28, mid: 30, mature: 24, senior: 18 },
    education: { primary_or_below: 28, secondary: 40, vocational: 18, university: 14 },
    income: { low: 16, middle: 56, high: 28 },
    urbanization: { urban: 88, suburban: 10, rural: 2 },
  },
  SE_GOT: {
    ethnicity: { swedish: 90, immigrant: 8, other: 2 },
    age: { young: 28, mid: 29, mature: 24, senior: 19 },
    education: { primary_or_below: 32, secondary: 40, vocational: 18, university: 10 },
    income: { low: 18, middle: 60, high: 22 },
    urbanization: { urban: 78, suburban: 12, rural: 10 },
  },
  SE_SKA: {
    ethnicity: { swedish: 91, immigrant: 7, other: 2 },
    age: { young: 27, mid: 28, mature: 25, senior: 20 },
    education: { primary_or_below: 34, secondary: 39, vocational: 18, university: 9 },
    income: { low: 20, middle: 60, high: 20 },
    urbanization: { urban: 66, suburban: 14, rural: 20 },
  },
  SE_EAS: {
    ethnicity: { swedish: 93, immigrant: 6, other: 1 },
    age: { young: 27, mid: 28, mature: 25, senior: 20 },
    education: { primary_or_below: 34, secondary: 40, vocational: 18, university: 8 },
    income: { low: 20, middle: 62, high: 18 },
    urbanization: { urban: 62, suburban: 14, rural: 24 },
  },
  SE_SML: {
    ethnicity: { swedish: 95, immigrant: 4, other: 1 },
    age: { young: 26, mid: 27, mature: 25, senior: 22 },
    education: { primary_or_below: 38, secondary: 39, vocational: 16, university: 7 },
    income: { low: 22, middle: 62, high: 16 },
    urbanization: { urban: 52, suburban: 14, rural: 34 },
  },
  SE_VML: {
    ethnicity: { swedish: 92, immigrant: 7, other: 1 },
    age: { young: 27, mid: 28, mature: 25, senior: 20 },
    education: { primary_or_below: 38, secondary: 40, vocational: 15, university: 7 },
    income: { low: 22, middle: 64, high: 14 },
    urbanization: { urban: 60, suburban: 14, rural: 26 },
  },
  SE_NOR: {
    ethnicity: { swedish: 95, immigrant: 4, other: 1 },
    age: { young: 26, mid: 27, mature: 25, senior: 22 },
    education: { primary_or_below: 38, secondary: 39, vocational: 16, university: 7 },
    income: { low: 24, middle: 62, high: 14 },
    urbanization: { urban: 50, suburban: 14, rural: 36 },
  },
  SE_UPP: {
    ethnicity: { swedish: 93, immigrant: 5, other: 2 },
    age: { young: 30, mid: 28, mature: 23, senior: 19 },
    education: { primary_or_below: 32, secondary: 38, vocational: 17, university: 13 },
    income: { low: 20, middle: 60, high: 20 },
    urbanization: { urban: 58, suburban: 14, rural: 28 },
  },
};

export default seRegionCensusData;
