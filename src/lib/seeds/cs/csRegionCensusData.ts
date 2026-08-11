/**
 * Czechoslovakia Layer-1 census (1979), one entry per region (Prague + the
 * historic lands). ethnicity: czech (titular) / slovak / other. Each dim sums
 * 100. Textures follow the 1970/1980 censuses: Slovakia's Hungarian minority
 * in the south ("other"), Prague the most urban and educated, industrial
 * Bohemia vs the more rural, younger Slovakia; Moravia sits between.
 */
export const csRegionCensusData = {
  CS_PRG: {
    ethnicity: { czech: 96, slovak: 2, other: 2 },
    age: { young: 21, mid: 28, mature: 27, senior: 24 },
    education: { primary_or_below: 24, secondary: 36, vocational: 27, university: 13 },
    income: { low: 14, middle: 68, high: 18 },
    urbanization: { urban: 94, suburban: 5, rural: 1 },
  },
  CS_BOH: {
    ethnicity: { czech: 95, slovak: 2, other: 3 },
    age: { young: 23, mid: 28, mature: 26, senior: 23 },
    education: { primary_or_below: 34, secondary: 33, vocational: 27, university: 6 },
    income: { low: 20, middle: 68, high: 12 },
    urbanization: { urban: 64, suburban: 13, rural: 23 },
  },
  CS_MOR: {
    ethnicity: { czech: 94, slovak: 3, other: 3 },
    age: { young: 25, mid: 28, mature: 25, senior: 22 },
    education: { primary_or_below: 36, secondary: 32, vocational: 26, university: 6 },
    income: { low: 22, middle: 66, high: 12 },
    urbanization: { urban: 62, suburban: 12, rural: 26 },
  },
  CS_SVK: {
    ethnicity: { czech: 4, slovak: 84, other: 12 },
    age: { young: 29, mid: 28, mature: 23, senior: 20 },
    education: { primary_or_below: 42, secondary: 30, vocational: 23, university: 5 },
    income: { low: 28, middle: 62, high: 10 },
    urbanization: { urban: 52, suburban: 12, rural: 36 },
  },
};
export default csRegionCensusData;
