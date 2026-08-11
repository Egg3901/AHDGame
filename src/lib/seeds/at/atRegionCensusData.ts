/**
 * Austria Layer-1 census (1979), one entry per macro-region. ethnicity:
 * austrian (titular) / minority (Carinthian Slovenes, Burgenland Croats and
 * Hungarians) / other (guest workers, mostly Yugoslav and Turkish). Each dim
 * sums 100. Textures follow the 1981 census: Vienna is old, urban and
 * educated; the Alpine west is Catholic-conservative and tourism-prosperous;
 * the industrial Mur-Mürz valley sits inside Styria & Carinthia.
 */
export interface ATRegionLayer1 {
  ethnicity: { austrian: number; minority: number; other: number };
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

export const atRegionCensusData: Record<string, ATRegionLayer1> = {
  AT_VIE: {
    ethnicity: { austrian: 91, minority: 2, other: 7 },
    age: { young: 19, mid: 27, mature: 26, senior: 28 },
    education: { primary_or_below: 30, secondary: 32, vocational: 26, university: 12 },
    income: { low: 20, middle: 62, high: 18 },
    urbanization: { urban: 94, suburban: 5, rural: 1 },
  },
  AT_NOE: {
    ethnicity: { austrian: 94, minority: 4, other: 2 },
    age: { young: 23, mid: 27, mature: 26, senior: 24 },
    education: { primary_or_below: 42, secondary: 28, vocational: 24, university: 6 },
    income: { low: 28, middle: 62, high: 10 },
    urbanization: { urban: 30, suburban: 24, rural: 46 },
  },
  AT_OOE: {
    ethnicity: { austrian: 95, minority: 1, other: 4 },
    age: { young: 25, mid: 28, mature: 25, senior: 22 },
    education: { primary_or_below: 40, secondary: 28, vocational: 26, university: 6 },
    income: { low: 26, middle: 62, high: 12 },
    urbanization: { urban: 42, suburban: 20, rural: 38 },
  },
  AT_STK: {
    ethnicity: { austrian: 93, minority: 4, other: 3 },
    age: { young: 24, mid: 27, mature: 26, senior: 23 },
    education: { primary_or_below: 42, secondary: 28, vocational: 24, university: 6 },
    income: { low: 30, middle: 60, high: 10 },
    urbanization: { urban: 40, suburban: 18, rural: 42 },
  },
  AT_TYR: {
    ethnicity: { austrian: 95, minority: 1, other: 4 },
    age: { young: 26, mid: 28, mature: 25, senior: 21 },
    education: { primary_or_below: 40, secondary: 28, vocational: 26, university: 6 },
    income: { low: 24, middle: 62, high: 14 },
    urbanization: { urban: 38, suburban: 18, rural: 44 },
  },
};
export default atRegionCensusData;
