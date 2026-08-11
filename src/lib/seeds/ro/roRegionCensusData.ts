/**
 * Romania Layer-1 census (1979), one entry per historic province. ethnicity:
 * romanian (titular) / hungarian / other. Each dim sums 100. Textures follow
 * the 1977 census: the Hungarian minority concentrates in Transylvania proper
 * (Székely Land) with a smaller share in the Banat/Crișana west (which also
 * carries Germans and Serbs in "other"); Bucharest is the most urban and
 * educated; Moldavia the most rural.
 */
export const roRegionCensusData = {
  RO_BUC: {
    ethnicity: { romanian: 96, hungarian: 1, other: 3 },
    age: { young: 26, mid: 29, mature: 24, senior: 21 },
    education: { primary_or_below: 34, secondary: 32, vocational: 22, university: 12 },
    income: { low: 22, middle: 64, high: 14 },
    urbanization: { urban: 90, suburban: 7, rural: 3 },
  },
  RO_MUN: {
    ethnicity: { romanian: 97, hungarian: 1, other: 2 },
    age: { young: 30, mid: 28, mature: 22, senior: 20 },
    education: { primary_or_below: 54, secondary: 27, vocational: 14, university: 5 },
    income: { low: 40, middle: 54, high: 6 },
    urbanization: { urban: 42, suburban: 12, rural: 46 },
  },
  RO_OLT: {
    ethnicity: { romanian: 98, hungarian: 1, other: 1 },
    age: { young: 31, mid: 28, mature: 22, senior: 19 },
    education: { primary_or_below: 56, secondary: 26, vocational: 13, university: 5 },
    income: { low: 44, middle: 50, high: 6 },
    urbanization: { urban: 40, suburban: 11, rural: 49 },
  },
  RO_TRA: {
    ethnicity: { romanian: 70, hungarian: 26, other: 4 },
    age: { young: 29, mid: 28, mature: 23, senior: 20 },
    education: { primary_or_below: 46, secondary: 28, vocational: 20, university: 6 },
    income: { low: 32, middle: 59, high: 9 },
    urbanization: { urban: 52, suburban: 12, rural: 36 },
  },
  RO_VST: {
    ethnicity: { romanian: 80, hungarian: 10, other: 10 },
    age: { young: 28, mid: 28, mature: 24, senior: 20 },
    education: { primary_or_below: 46, secondary: 28, vocational: 20, university: 6 },
    income: { low: 32, middle: 59, high: 9 },
    urbanization: { urban: 54, suburban: 12, rural: 34 },
  },
  RO_MOL: {
    ethnicity: { romanian: 97, hungarian: 1, other: 2 },
    age: { young: 32, mid: 28, mature: 21, senior: 19 },
    education: { primary_or_below: 58, secondary: 25, vocational: 12, university: 5 },
    income: { low: 46, middle: 48, high: 6 },
    urbanization: { urban: 38, suburban: 12, rural: 50 },
  },
  RO_DOB: {
    ethnicity: { romanian: 91, hungarian: 1, other: 8 },
    age: { young: 30, mid: 28, mature: 22, senior: 20 },
    education: { primary_or_below: 52, secondary: 27, vocational: 15, university: 6 },
    income: { low: 38, middle: 55, high: 7 },
    urbanization: { urban: 50, suburban: 12, rural: 38 },
  },
};
export default roRegionCensusData;
