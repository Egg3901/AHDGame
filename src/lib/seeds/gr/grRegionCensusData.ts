/**
 * Greece Layer-1 census (1979), one entry per macro-region. ethnicity: greek
 * (titular) / minority (Thracian Muslims, Slavophones, Vlachs, Arvanites) /
 * other. Each dim sums 100. Textures follow the 1981 census: Attica is the
 * most urban and educated; the Muslim minority concentrates in Thrace (inside
 * Macedonia & Thrace); the islands mix shipping wealth with rural depopulation.
 */
export interface GRRegionLayer1 {
  ethnicity: { greek: number; minority: number; other: number };
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

export const grRegionCensusData: Record<string, GRRegionLayer1> = {
  GR_ATT: {
    ethnicity: { greek: 97, minority: 1, other: 2 },
    age: { young: 24, mid: 29, mature: 26, senior: 21 },
    education: { primary_or_below: 34, secondary: 34, vocational: 20, university: 12 },
    income: { low: 22, middle: 62, high: 16 },
    urbanization: { urban: 88, suburban: 9, rural: 3 },
  },
  GR_MAC: {
    ethnicity: { greek: 91, minority: 7, other: 2 },
    age: { young: 26, mid: 28, mature: 25, senior: 21 },
    education: { primary_or_below: 48, secondary: 30, vocational: 16, university: 6 },
    income: { low: 32, middle: 58, high: 10 },
    urbanization: { urban: 52, suburban: 12, rural: 36 },
  },
  GR_THE: {
    ethnicity: { greek: 97, minority: 2, other: 1 },
    age: { young: 25, mid: 27, mature: 25, senior: 23 },
    education: { primary_or_below: 54, secondary: 27, vocational: 14, university: 5 },
    income: { low: 36, middle: 56, high: 8 },
    urbanization: { urban: 44, suburban: 11, rural: 45 },
  },
  GR_EPC: {
    ethnicity: { greek: 96, minority: 3, other: 1 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    education: { primary_or_below: 56, secondary: 26, vocational: 13, university: 5 },
    income: { low: 40, middle: 53, high: 7 },
    urbanization: { urban: 38, suburban: 11, rural: 51 },
  },
  GR_PEL: {
    ethnicity: { greek: 98, minority: 1, other: 1 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    education: { primary_or_below: 55, secondary: 27, vocational: 13, university: 5 },
    income: { low: 38, middle: 55, high: 7 },
    urbanization: { urban: 40, suburban: 11, rural: 49 },
  },
  GR_ISL: {
    ethnicity: { greek: 97, minority: 2, other: 1 },
    age: { young: 24, mid: 26, mature: 25, senior: 25 },
    education: { primary_or_below: 52, secondary: 28, vocational: 14, university: 6 },
    income: { low: 34, middle: 55, high: 11 },
    urbanization: { urban: 44, suburban: 12, rural: 44 },
  },
};
export default grRegionCensusData;
