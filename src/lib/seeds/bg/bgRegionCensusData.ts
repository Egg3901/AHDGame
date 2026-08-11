/**
 * Bulgaria Layer-1 census (1979), one entry per region. ethnicity: bulgarian
 * (titular) / turkish / other. Each dim sums 100. Textures follow the 1975
 * census: the Turkish minority concentrates in the northeast (Razgrad/Shumen
 * in the Danubian region, Dobrich on the coast) and the eastern Rhodopes
 * (Kardzhali, in Thrace); Sofia is the most urban and educated; the southwest
 * (Pirin) carries the Pomak valleys.
 */
export const bgRegionCensusData = {
  BG_SOF: {
    ethnicity: { bulgarian: 97, turkish: 1, other: 2 },
    age: { young: 23, mid: 29, mature: 26, senior: 22 },
    education: { primary_or_below: 32, secondary: 36, vocational: 21, university: 11 },
    income: { low: 22, middle: 66, high: 12 },
    urbanization: { urban: 84, suburban: 9, rural: 7 },
  },
  BG_NOR: {
    ethnicity: { bulgarian: 82, turkish: 13, other: 5 },
    age: { young: 25, mid: 27, mature: 25, senior: 23 },
    education: { primary_or_below: 52, secondary: 28, vocational: 15, university: 5 },
    income: { low: 35, middle: 58, high: 7 },
    urbanization: { urban: 52, suburban: 12, rural: 36 },
  },
  BG_COA: {
    ethnicity: { bulgarian: 82, turkish: 12, other: 6 },
    age: { young: 26, mid: 28, mature: 25, senior: 21 },
    education: { primary_or_below: 46, secondary: 30, vocational: 18, university: 6 },
    income: { low: 30, middle: 61, high: 9 },
    urbanization: { urban: 62, suburban: 12, rural: 26 },
  },
  BG_THR: {
    ethnicity: { bulgarian: 81, turkish: 12, other: 7 },
    age: { young: 26, mid: 28, mature: 25, senior: 21 },
    education: { primary_or_below: 50, secondary: 29, vocational: 16, university: 5 },
    income: { low: 33, middle: 59, high: 8 },
    urbanization: { urban: 56, suburban: 12, rural: 32 },
  },
  BG_SW: {
    ethnicity: { bulgarian: 90, turkish: 3, other: 7 },
    age: { young: 26, mid: 28, mature: 24, senior: 22 },
    education: { primary_or_below: 54, secondary: 27, vocational: 14, university: 5 },
    income: { low: 38, middle: 56, high: 6 },
    urbanization: { urban: 44, suburban: 12, rural: 44 },
  },
};
export default bgRegionCensusData;
