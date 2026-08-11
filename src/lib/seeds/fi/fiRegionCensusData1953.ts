import type { FIRegionLayer1 } from "./fiRegionCensusData";

/**
 * Finland Layer-1 census (1953), one entry per macro-region. The postwar
 * republic: young (the great baby-boom cohorts), overwhelmingly rural and
 * agrarian, Karelian evacuees swelling the east and Häme on cold-farm
 * smallholdings, education still primary-dominated, the Swedish-speaking
 * minority ~8.5% nationally.
 */
export const fiRegionCensusData1953: Record<string, FIRegionLayer1> = {
  FI_UUS: {
    ethnicity: { finnish: 85, minority: 14, other: 1 },
    age: { young: 30, mid: 27, mature: 24, senior: 19 },
    education: { primary_or_below: 54, secondary: 24, vocational: 15, university: 7 },
    income: { low: 30, middle: 58, high: 12 },
    urbanization: { urban: 72, suburban: 12, rural: 16 },
  },
  FI_SW: {
    ethnicity: { finnish: 89, minority: 10, other: 1 },
    age: { young: 30, mid: 26, mature: 24, senior: 20 },
    education: { primary_or_below: 64, secondary: 20, vocational: 12, university: 4 },
    income: { low: 40, middle: 52, high: 8 },
    urbanization: { urban: 40, suburban: 10, rural: 50 },
  },
  FI_HAM: {
    ethnicity: { finnish: 97, minority: 2, other: 1 },
    age: { young: 31, mid: 26, mature: 24, senior: 19 },
    education: { primary_or_below: 66, secondary: 19, vocational: 12, university: 3 },
    income: { low: 42, middle: 51, high: 7 },
    urbanization: { urban: 36, suburban: 10, rural: 54 },
  },
  FI_EAS: {
    ethnicity: { finnish: 99, minority: 0, other: 1 },
    age: { young: 33, mid: 25, mature: 23, senior: 19 },
    education: { primary_or_below: 74, secondary: 15, vocational: 9, university: 2 },
    income: { low: 54, middle: 42, high: 4 },
    urbanization: { urban: 20, suburban: 8, rural: 72 },
  },
  FI_OST: {
    ethnicity: { finnish: 85, minority: 14, other: 1 },
    age: { young: 33, mid: 25, mature: 23, senior: 19 },
    education: { primary_or_below: 72, secondary: 16, vocational: 9, university: 3 },
    income: { low: 50, middle: 45, high: 5 },
    urbanization: { urban: 22, suburban: 8, rural: 70 },
  },
  FI_LAP: {
    ethnicity: { finnish: 93, minority: 6, other: 1 },
    age: { young: 35, mid: 25, mature: 22, senior: 18 },
    education: { primary_or_below: 76, secondary: 14, vocational: 8, university: 2 },
    income: { low: 56, middle: 40, high: 4 },
    urbanization: { urban: 16, suburban: 6, rural: 78 },
  },
};
export default fiRegionCensusData1953;
