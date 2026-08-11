/**
 * Bulgaria Layer-1 census (1953, the Chervenkov years), one entry per region.
 * ethnicity: bulgarian (titular) / turkish / other. Each dim sums 100.
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly, keyed to the same region codes as the 1979
 * bundle (matching bgRegions1953.ts).
 *
 * Key 1953 anchors (vs 1979):
 * - Bulgaria in 1946 was ~25% urban; by 1979 it is around 60%. The forced-draft
 *   industrialisation that produced that swing is only starting, so every region
 *   outside Sofia is overwhelmingly rural.
 * - Collectivisation (the TKZS drive) is at its most violent between 1950 and
 *   1953 and is not yet complete, so the countryside is still a smallholder
 *   society in living memory.
 * - Education: a mostly primary-schooled adult stock; the gimnazium and technical
 *   streams widen only later, and university attainment is ~1-3%.
 * - Age: young and high-fertility, before the demographic transition that leaves
 *   1979 Bulgaria one of the older bloc populations.
 * - Ethnicity: the 1950-51 expulsion of roughly 150,000 Turks to Turkey has just
 *   happened, but the northeast and the eastern Rhodopes still carry the largest
 *   Turkish shares; the Pomak valleys of the southwest sit in `other`, and the
 *   "Revival Process" assimilation campaign is three decades away.
 */
export const bgRegionCensusData1953 = {
  BG_SOF: {
    // Sofia: capital and the one substantially urban region
    ethnicity: { bulgarian: 96, turkish: 1, other: 3 },
    age: { young: 28, mid: 29, mature: 24, senior: 19 },
    education: { primary_or_below: 58, secondary: 25, vocational: 13, university: 4 },
    income: { low: 38, middle: 57, high: 5 },
    urbanization: { urban: 70, suburban: 14, rural: 16 },
  },
  BG_NOR: {
    // Danubian north: grain plain, and the heaviest Turkish minority (Razgrad/Shumen)
    ethnicity: { bulgarian: 79, turkish: 16, other: 5 },
    age: { young: 32, mid: 28, mature: 23, senior: 17 },
    education: { primary_or_below: 78, secondary: 15, vocational: 6, university: 1 },
    income: { low: 56, middle: 42, high: 2 },
    urbanization: { urban: 26, suburban: 10, rural: 64 },
  },
  BG_COA: {
    // Black Sea coast: Varna and Burgas ports; mixed Turkish/Gagauz hinterland
    ethnicity: { bulgarian: 80, turkish: 14, other: 6 },
    age: { young: 31, mid: 28, mature: 23, senior: 18 },
    education: { primary_or_below: 72, secondary: 18, vocational: 8, university: 2 },
    income: { low: 50, middle: 48, high: 2 },
    urbanization: { urban: 34, suburban: 12, rural: 54 },
  },
  BG_THR: {
    // Thracian plain and the eastern Rhodopes: tobacco, and Kardzhali's Turks
    ethnicity: { bulgarian: 78, turkish: 15, other: 7 },
    age: { young: 32, mid: 28, mature: 23, senior: 17 },
    education: { primary_or_below: 76, secondary: 16, vocational: 7, university: 1 },
    income: { low: 54, middle: 44, high: 2 },
    urbanization: { urban: 30, suburban: 11, rural: 59 },
  },
  BG_SW: {
    // Pirin/southwest: mountain smallholders and the Pomak valleys
    ethnicity: { bulgarian: 88, turkish: 3, other: 9 },
    age: { young: 32, mid: 28, mature: 23, senior: 17 },
    education: { primary_or_below: 80, secondary: 14, vocational: 5, university: 1 },
    income: { low: 60, middle: 38, high: 2 },
    urbanization: { urban: 22, suburban: 10, rural: 68 },
  },
};
export default bgRegionCensusData1953;
