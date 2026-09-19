/**
 * France Region Census Profiles — Layer 1 demographic breakdown per region (1979).
 * Mirrors the CN/SU census files; France is 1979-preset-only here.
 *
 * SEED INDEPENDENCE — authored for ~1979 directly.
 *
 * Ethnicity groups the late-1970s French population: French majority, European
 * immigrants (Italian/Spanish/Portuguese), North-African (Maghrebi) immigrants,
 * and an aggregated other. Each dimension sums to 100.
 */

export interface FRRegionLayer1 {
  ethnicity: { french: number; european_immigrant: number; north_african: number; other: number };
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

export const frRegionCensusData: Record<string, FRRegionLayer1> = {
  FR_IDF: {
    ethnicity: { french: 82, european_immigrant: 8, north_african: 7, other: 3 },
    age: { young: 30, mid: 30, mature: 24, senior: 16 },
    education: { primary_or_below: 30, secondary: 38, vocational: 17, university: 15 },
    income: { low: 22, middle: 52, high: 26 },
    urbanization: { urban: 92, suburban: 6, rural: 2 },
  },
  FR_NOR: {
    ethnicity: { french: 90, european_immigrant: 6, north_african: 3, other: 1 },
    age: { young: 30, mid: 28, mature: 24, senior: 18 },
    education: { primary_or_below: 44, secondary: 34, vocational: 16, university: 6 },
    income: { low: 32, middle: 56, high: 12 },
    urbanization: { urban: 70, suburban: 12, rural: 18 },
  },
  FR_EST: {
    ethnicity: { french: 89, european_immigrant: 6, north_african: 4, other: 1 },
    age: { young: 28, mid: 28, mature: 24, senior: 20 },
    education: { primary_or_below: 42, secondary: 34, vocational: 17, university: 7 },
    income: { low: 28, middle: 58, high: 14 },
    urbanization: { urban: 66, suburban: 12, rural: 22 },
  },
  FR_OUE: {
    ethnicity: { french: 96, european_immigrant: 2, north_african: 1, other: 1 },
    age: { young: 27, mid: 26, mature: 25, senior: 22 },
    education: { primary_or_below: 48, secondary: 32, vocational: 14, university: 6 },
    income: { low: 30, middle: 58, high: 12 },
    urbanization: { urban: 52, suburban: 12, rural: 36 },
  },
  FR_SOU: {
    ethnicity: { french: 90, european_immigrant: 7, north_african: 2, other: 1 },
    age: { young: 26, mid: 26, mature: 25, senior: 23 },
    education: { primary_or_below: 46, secondary: 33, vocational: 14, university: 7 },
    income: { low: 30, middle: 56, high: 14 },
    urbanization: { urban: 56, suburban: 12, rural: 32 },
  },
  FR_ARA: {
    ethnicity: { french: 86, european_immigrant: 8, north_african: 5, other: 1 },
    age: { young: 29, mid: 28, mature: 24, senior: 19 },
    education: { primary_or_below: 40, secondary: 35, vocational: 16, university: 9 },
    income: { low: 26, middle: 56, high: 18 },
    urbanization: { urban: 70, suburban: 12, rural: 18 },
  },
  FR_MED: {
    ethnicity: { french: 84, european_immigrant: 9, north_african: 6, other: 1 },
    age: { young: 27, mid: 26, mature: 24, senior: 23 },
    education: { primary_or_below: 42, secondary: 35, vocational: 15, university: 8 },
    income: { low: 30, middle: 54, high: 16 },
    urbanization: { urban: 72, suburban: 12, rural: 16 },
  },
  FR_CEN: {
    ethnicity: { french: 95, european_immigrant: 3, north_african: 1, other: 1 },
    age: { young: 26, mid: 26, mature: 25, senior: 23 },
    education: { primary_or_below: 48, secondary: 33, vocational: 13, university: 6 },
    income: { low: 30, middle: 58, high: 12 },
    urbanization: { urban: 54, suburban: 12, rural: 34 },
  },
};

export default frRegionCensusData;
