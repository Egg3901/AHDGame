/**
 * Yugoslavia Layer-1 census (1979), one entry per federal unit. ethnicity:
 * south_slav (all titular Yugoslav nations) / albanian / other. Each dim sums
 * 100. Textures follow the 1971/1981 censuses: Kosovo's Albanian majority,
 * Vojvodina's Hungarian (and other) minorities, Macedonia's Albanian west; the
 * developed NW (Slovenia, Croatia) is more urban/educated than the south.
 */
export const yuRegionCensusData = {
  YU_SLO: {
    ethnicity: { south_slav: 96, albanian: 1, other: 3 },
    age: { young: 24, mid: 28, mature: 25, senior: 23 },
    education: { primary_or_below: 34, secondary: 34, vocational: 22, university: 10 },
    income: { low: 18, middle: 60, high: 22 },
    urbanization: { urban: 64, suburban: 16, rural: 20 },
  },
  YU_CRO: {
    ethnicity: { south_slav: 95, albanian: 1, other: 4 },
    age: { young: 25, mid: 28, mature: 25, senior: 22 },
    education: { primary_or_below: 40, secondary: 32, vocational: 20, university: 8 },
    income: { low: 22, middle: 60, high: 18 },
    urbanization: { urban: 60, suburban: 14, rural: 26 },
  },
  YU_BIH: {
    ethnicity: { south_slav: 96, albanian: 1, other: 3 },
    age: { young: 32, mid: 28, mature: 22, senior: 18 },
    education: { primary_or_below: 54, secondary: 28, vocational: 13, university: 5 },
    income: { low: 38, middle: 54, high: 8 },
    urbanization: { urban: 40, suburban: 14, rural: 46 },
  },
  YU_SRB: {
    ethnicity: { south_slav: 95, albanian: 2, other: 3 },
    age: { young: 27, mid: 28, mature: 24, senior: 21 },
    education: { primary_or_below: 48, secondary: 30, vocational: 15, university: 7 },
    income: { low: 30, middle: 58, high: 12 },
    urbanization: { urban: 50, suburban: 14, rural: 36 },
  },
  YU_VOJ: {
    ethnicity: { south_slav: 76, albanian: 1, other: 23 },
    age: { young: 25, mid: 28, mature: 25, senior: 22 },
    education: { primary_or_below: 44, secondary: 32, vocational: 17, university: 7 },
    income: { low: 26, middle: 60, high: 14 },
    urbanization: { urban: 52, suburban: 14, rural: 34 },
  },
  YU_KOS: {
    ethnicity: { south_slav: 20, albanian: 77, other: 3 },
    age: { young: 44, mid: 26, mature: 17, senior: 13 },
    education: { primary_or_below: 68, secondary: 20, vocational: 8, university: 4 },
    income: { low: 58, middle: 38, high: 4 },
    urbanization: { urban: 32, suburban: 10, rural: 58 },
  },
  YU_MNE: {
    ethnicity: { south_slav: 91, albanian: 7, other: 2 },
    age: { young: 32, mid: 28, mature: 22, senior: 18 },
    education: { primary_or_below: 50, secondary: 30, vocational: 14, university: 6 },
    income: { low: 40, middle: 52, high: 8 },
    urbanization: { urban: 42, suburban: 12, rural: 46 },
  },
  YU_MKD: {
    ethnicity: { south_slav: 70, albanian: 20, other: 10 },
    age: { young: 34, mid: 28, mature: 21, senior: 17 },
    education: { primary_or_below: 56, secondary: 26, vocational: 12, university: 6 },
    income: { low: 44, middle: 50, high: 6 },
    urbanization: { urban: 44, suburban: 12, rural: 44 },
  },
};
export default yuRegionCensusData;
