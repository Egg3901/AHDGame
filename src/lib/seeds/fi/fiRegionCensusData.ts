/**
 * Finland Layer-1 census (1979), one entry per macro-region. ethnicity:
 * finnish (titular) / minority (Swedish-speaking Finns, concentrated on the
 * Ostrobothnian and southwest coasts and Uusimaa; Sámi in Lapland) / other.
 * Each dim sums 100. Textures: the great 1960s–70s rural exodus has emptied
 * the east and north toward Helsinki (and Sweden); Uusimaa is educated and
 * white-collar; the east remains smallholder country.
 */
export interface FIRegionLayer1 {
  ethnicity: { finnish: number; minority: number; other: number };
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

export const fiRegionCensusData: Record<string, FIRegionLayer1> = {
  FI_UUS: {
    ethnicity: { finnish: 89, minority: 10, other: 1 },
    age: { young: 24, mid: 30, mature: 26, senior: 20 },
    education: { primary_or_below: 30, secondary: 30, vocational: 26, university: 14 },
    income: { low: 18, middle: 62, high: 20 },
    urbanization: { urban: 82, suburban: 14, rural: 4 },
  },
  FI_SW: {
    ethnicity: { finnish: 91, minority: 8, other: 1 },
    age: { young: 23, mid: 28, mature: 26, senior: 23 },
    education: { primary_or_below: 38, secondary: 28, vocational: 26, university: 8 },
    income: { low: 24, middle: 62, high: 14 },
    urbanization: { urban: 54, suburban: 16, rural: 30 },
  },
  FI_HAM: {
    ethnicity: { finnish: 98, minority: 1, other: 1 },
    age: { young: 24, mid: 28, mature: 26, senior: 22 },
    education: { primary_or_below: 40, secondary: 28, vocational: 26, university: 6 },
    income: { low: 26, middle: 62, high: 12 },
    urbanization: { urban: 52, suburban: 16, rural: 32 },
  },
  FI_EAS: {
    ethnicity: { finnish: 99, minority: 0, other: 1 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    education: { primary_or_below: 48, secondary: 26, vocational: 21, university: 5 },
    income: { low: 34, middle: 58, high: 8 },
    urbanization: { urban: 36, suburban: 12, rural: 52 },
  },
  FI_OST: {
    ethnicity: { finnish: 87, minority: 12, other: 1 },
    age: { young: 26, mid: 26, mature: 25, senior: 23 },
    education: { primary_or_below: 46, secondary: 26, vocational: 22, university: 6 },
    income: { low: 30, middle: 60, high: 10 },
    urbanization: { urban: 38, suburban: 12, rural: 50 },
  },
  FI_LAP: {
    ethnicity: { finnish: 95, minority: 4, other: 1 },
    age: { young: 27, mid: 27, mature: 25, senior: 21 },
    education: { primary_or_below: 48, secondary: 26, vocational: 21, university: 5 },
    income: { low: 34, middle: 58, high: 8 },
    urbanization: { urban: 34, suburban: 10, rural: 56 },
  },
};
export default fiRegionCensusData;
