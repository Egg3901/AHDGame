import type { GRRegionLayer1 } from "./grRegionCensusData";

/**
 * Greece Layer-1 census (1953), one entry per macro-region. Post-civil-war
 * kingdom: far more rural and agricultural than 1979, mass emigration and the
 * Athens influx just beginning, lower education throughout, and the Thracian
 * Muslim minority proportionally larger in the underpopulated north.
 */
export const grRegionCensusData1953: Record<string, GRRegionLayer1> = {
  GR_ATT: {
    ethnicity: { greek: 96, minority: 1, other: 3 },
    age: { young: 28, mid: 28, mature: 24, senior: 20 },
    education: { primary_or_below: 56, secondary: 26, vocational: 12, university: 6 },
    income: { low: 38, middle: 54, high: 8 },
    urbanization: { urban: 80, suburban: 10, rural: 10 },
  },
  GR_MAC: {
    ethnicity: { greek: 89, minority: 9, other: 2 },
    age: { young: 30, mid: 27, mature: 23, senior: 20 },
    education: { primary_or_below: 70, secondary: 18, vocational: 8, university: 4 },
    income: { low: 52, middle: 43, high: 5 },
    urbanization: { urban: 34, suburban: 10, rural: 56 },
  },
  GR_THE: {
    ethnicity: { greek: 96, minority: 3, other: 1 },
    age: { young: 30, mid: 27, mature: 23, senior: 20 },
    education: { primary_or_below: 74, secondary: 16, vocational: 6, university: 4 },
    income: { low: 56, middle: 40, high: 4 },
    urbanization: { urban: 28, suburban: 9, rural: 63 },
  },
  GR_EPC: {
    ethnicity: { greek: 95, minority: 4, other: 1 },
    age: { young: 30, mid: 26, mature: 23, senior: 21 },
    education: { primary_or_below: 78, secondary: 13, vocational: 5, university: 4 },
    income: { low: 60, middle: 37, high: 3 },
    urbanization: { urban: 22, suburban: 8, rural: 70 },
  },
  GR_PEL: {
    ethnicity: { greek: 98, minority: 1, other: 1 },
    age: { young: 29, mid: 26, mature: 24, senior: 21 },
    education: { primary_or_below: 74, secondary: 16, vocational: 6, university: 4 },
    income: { low: 56, middle: 40, high: 4 },
    urbanization: { urban: 26, suburban: 9, rural: 65 },
  },
  GR_ISL: {
    ethnicity: { greek: 97, minority: 2, other: 1 },
    age: { young: 28, mid: 26, mature: 24, senior: 22 },
    education: { primary_or_below: 72, secondary: 17, vocational: 6, university: 5 },
    income: { low: 52, middle: 42, high: 6 },
    urbanization: { urban: 30, suburban: 10, rural: 60 },
  },
};
export default grRegionCensusData1953;
