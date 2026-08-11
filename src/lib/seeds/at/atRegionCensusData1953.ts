import type { ATRegionLayer1 } from "./atRegionCensusData";

/**
 * Austria Layer-1 census (1953), one entry per macro-region. The occupied
 * Second Republic: prewar demography scarred by the war (a thin male mid
 * cohort, many seniors), refugees and displaced persons in "other", far
 * lower tertiary education, and a much more agrarian countryside.
 */
export const atRegionCensusData1953: Record<string, ATRegionLayer1> = {
  AT_VIE: {
    ethnicity: { austrian: 92, minority: 2, other: 6 },
    age: { young: 20, mid: 25, mature: 26, senior: 29 },
    education: { primary_or_below: 52, secondary: 26, vocational: 16, university: 6 },
    income: { low: 34, middle: 56, high: 10 },
    urbanization: { urban: 94, suburban: 5, rural: 1 },
  },
  AT_NOE: {
    ethnicity: { austrian: 93, minority: 4, other: 3 },
    age: { young: 24, mid: 25, mature: 26, senior: 25 },
    education: { primary_or_below: 68, secondary: 18, vocational: 10, university: 4 },
    income: { low: 46, middle: 48, high: 6 },
    urbanization: { urban: 24, suburban: 18, rural: 58 },
  },
  AT_OOE: {
    ethnicity: { austrian: 92, minority: 1, other: 7 },
    age: { young: 26, mid: 26, mature: 25, senior: 23 },
    education: { primary_or_below: 66, secondary: 18, vocational: 12, university: 4 },
    income: { low: 42, middle: 51, high: 7 },
    urbanization: { urban: 32, suburban: 16, rural: 52 },
  },
  AT_STK: {
    ethnicity: { austrian: 92, minority: 5, other: 3 },
    age: { young: 25, mid: 25, mature: 26, senior: 24 },
    education: { primary_or_below: 68, secondary: 17, vocational: 11, university: 4 },
    income: { low: 46, middle: 48, high: 6 },
    urbanization: { urban: 32, suburban: 14, rural: 54 },
  },
  AT_TYR: {
    ethnicity: { austrian: 95, minority: 1, other: 4 },
    age: { young: 27, mid: 26, mature: 25, senior: 22 },
    education: { primary_or_below: 68, secondary: 17, vocational: 11, university: 4 },
    income: { low: 44, middle: 49, high: 7 },
    urbanization: { urban: 26, suburban: 14, rural: 60 },
  },
};
export default atRegionCensusData1953;
