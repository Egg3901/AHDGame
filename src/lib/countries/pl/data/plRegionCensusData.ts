/**
 * Poland Layer-1 census (1979), one entry per macro-region. Each dim sums 100.
 * ethnicity: polish (titular) / minority / other — postwar Poland is nearly
 * homogeneous; the small Belarusian/Ukrainian communities sit in the east and
 * the German remainder in Silesia. Warsaw (Mazovia) and industrial Silesia are
 * the most urban; the east is the most rural and agricultural.
 */
export const plRegionCensusData = {
  PL_MAZ: {
    ethnicity: { polish: 98, minority: 1, other: 1 },
    age: { young: 25, mid: 28, mature: 25, senior: 22 },
    education: { primary_or_below: 36, secondary: 32, vocational: 22, university: 10 },
    income: { low: 24, middle: 64, high: 12 },
    urbanization: { urban: 66, suburban: 12, rural: 22 },
  },
  PL_LOD: {
    ethnicity: { polish: 98, minority: 1, other: 1 },
    age: { young: 25, mid: 28, mature: 25, senior: 22 },
    education: { primary_or_below: 44, secondary: 30, vocational: 20, university: 6 },
    income: { low: 30, middle: 62, high: 8 },
    urbanization: { urban: 56, suburban: 12, rural: 32 },
  },
  PL_MAL: {
    ethnicity: { polish: 98, minority: 1, other: 1 },
    age: { young: 27, mid: 28, mature: 24, senior: 21 },
    education: { primary_or_below: 42, secondary: 30, vocational: 21, university: 7 },
    income: { low: 28, middle: 63, high: 9 },
    urbanization: { urban: 52, suburban: 12, rural: 36 },
  },
  PL_SLK: {
    ethnicity: { polish: 96, minority: 3, other: 1 },
    age: { young: 27, mid: 29, mature: 24, senior: 20 },
    education: { primary_or_below: 38, secondary: 30, vocational: 26, university: 6 },
    income: { low: 22, middle: 66, high: 12 },
    urbanization: { urban: 78, suburban: 10, rural: 12 },
  },
  PL_DSL: {
    ethnicity: { polish: 97, minority: 2, other: 1 },
    age: { young: 27, mid: 28, mature: 24, senior: 21 },
    education: { primary_or_below: 42, secondary: 30, vocational: 22, university: 6 },
    income: { low: 26, middle: 65, high: 9 },
    urbanization: { urban: 64, suburban: 12, rural: 24 },
  },
  PL_WLK: {
    ethnicity: { polish: 98, minority: 1, other: 1 },
    age: { young: 26, mid: 28, mature: 24, senior: 22 },
    education: { primary_or_below: 44, secondary: 30, vocational: 21, university: 5 },
    income: { low: 28, middle: 64, high: 8 },
    urbanization: { urban: 54, suburban: 12, rural: 34 },
  },
  PL_POM: {
    ethnicity: { polish: 97, minority: 2, other: 1 },
    age: { young: 28, mid: 28, mature: 24, senior: 20 },
    education: { primary_or_below: 44, secondary: 30, vocational: 20, university: 6 },
    income: { low: 30, middle: 62, high: 8 },
    urbanization: { urban: 58, suburban: 12, rural: 30 },
  },
  PL_EAS: {
    ethnicity: { polish: 95, minority: 4, other: 1 },
    age: { young: 27, mid: 27, mature: 24, senior: 22 },
    education: { primary_or_below: 52, secondary: 28, vocational: 15, university: 5 },
    income: { low: 38, middle: 56, high: 6 },
    urbanization: { urban: 42, suburban: 10, rural: 48 },
  },
};
export default plRegionCensusData;
