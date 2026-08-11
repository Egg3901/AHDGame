/**
 * Hungary Layer-1 census (1979), one entry per region. Each dim sums 100.
 * Textures follow the 1980 census: Budapest is the most urban and educated;
 * Southern Transdanubia (Baranya) carries the German ("Swabian") minority
 * villages; Northern Hungary and the Great Plain carry Slovak and Romani
 * minorities and the most rural population.
 */
export interface HURegionLayer1 {
  ethnicity: { hungarian: number; minority: number; other: number };
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
export const huRegionCensusData: Record<string, HURegionLayer1> = {
  HU_BUD: {
    ethnicity: { hungarian: 98, minority: 1, other: 1 },
    age: { young: 21, mid: 28, mature: 27, senior: 24 },
    education: { primary_or_below: 26, secondary: 37, vocational: 25, university: 12 },
    income: { low: 16, middle: 68, high: 16 },
    urbanization: { urban: 92, suburban: 6, rural: 2 },
  },
  HU_PES: {
    ethnicity: { hungarian: 96, minority: 3, other: 1 },
    age: { young: 24, mid: 28, mature: 26, senior: 22 },
    education: { primary_or_below: 42, secondary: 32, vocational: 21, university: 5 },
    income: { low: 24, middle: 68, high: 8 },
    urbanization: { urban: 38, suburban: 34, rural: 28 },
  },
  HU_TRW: {
    ethnicity: { hungarian: 95, minority: 4, other: 1 },
    age: { young: 24, mid: 28, mature: 26, senior: 22 },
    education: { primary_or_below: 40, secondary: 32, vocational: 23, university: 5 },
    income: { low: 24, middle: 67, high: 9 },
    urbanization: { urban: 52, suburban: 12, rural: 36 },
  },
  HU_TRS: {
    ethnicity: { hungarian: 93, minority: 6, other: 1 },
    age: { young: 24, mid: 28, mature: 25, senior: 23 },
    education: { primary_or_below: 46, secondary: 29, vocational: 20, university: 5 },
    income: { low: 30, middle: 63, high: 7 },
    urbanization: { urban: 46, suburban: 11, rural: 43 },
  },
  HU_NOR: {
    ethnicity: { hungarian: 94, minority: 5, other: 1 },
    age: { young: 26, mid: 28, mature: 25, senior: 21 },
    education: { primary_or_below: 48, secondary: 29, vocational: 19, university: 4 },
    income: { low: 32, middle: 62, high: 6 },
    urbanization: { urban: 46, suburban: 12, rural: 42 },
  },
  HU_ALF: {
    ethnicity: { hungarian: 95, minority: 4, other: 1 },
    age: { young: 26, mid: 28, mature: 25, senior: 21 },
    education: { primary_or_below: 47, secondary: 30, vocational: 19, university: 4 },
    income: { low: 31, middle: 63, high: 6 },
    urbanization: { urban: 42, suburban: 10, rural: 48 },
  },
};
export default huRegionCensusData;
