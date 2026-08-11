/**
 * Ukraine (Ukrainian SSR) Layer-1 census (1979, the Shcherbytsky years), one
 * entry per macro-region. ethnicity: ukrainian (titular) / russian / other.
 * Each dim sums 100. Keys MUST match the region `_id` values in uaRegions.ts.
 *
 * Textures follow the January 1979 census: 73.6% Ukrainian and 21.1% Russian
 * republic-wide, with the Russian share tracking industry and the coast rather
 * than being spread evenly. Donbas is the only region where Russians are the
 * plurality; the Crimean component of the south (transferred from the RSFSR in
 * 1954) is the reason the coastal Russian share runs so far above the Dnieper
 * belt's. The west stays overwhelmingly titular, with Transcarpathian
 * Hungarians and Bukovinian Romanians in `other`.
 *
 * Against 1953: urbanisation is up everywhere and has roughly doubled outside
 * Donbas, the primary-or-below stock has collapsed as the wartime cohorts age
 * out and universal secondary schooling works through, and the age profile has
 * flipped from young-and-rebuilding to the low-fertility, ageing shape that
 * defines the late Brezhnev republic. Income is still compressed, but the
 * middle band is now genuinely broad rather than a floor with a name.
 */
export const uaRegionCensusData = {
  UKR_KYI: {
    ethnicity: { ukrainian: 86, russian: 11, other: 3 },
    age: { young: 24, mid: 28, mature: 26, senior: 22 },
    education: { primary_or_below: 40, secondary: 32, vocational: 19, university: 9 },
    income: { low: 26, middle: 64, high: 10 },
    urbanization: { urban: 62, suburban: 13, rural: 25 },
  },
  UKR_WES: {
    // Industrialised in patches (Lviv buses, Volhynian coal, Transcarpathian
    // light industry) but still the most rural and the least Russified.
    ethnicity: { ukrainian: 87, russian: 6, other: 7 },
    age: { young: 27, mid: 28, mature: 24, senior: 21 }, // still the highest fertility
    education: { primary_or_below: 52, secondary: 30, vocational: 14, university: 4 },
    income: { low: 38, middle: 57, high: 5 },
    urbanization: { urban: 44, suburban: 12, rural: 44 },
  },
  UKR_POD: {
    ethnicity: { ukrainian: 91, russian: 5, other: 4 },
    age: { young: 24, mid: 26, mature: 25, senior: 25 }, // out-migration ages the villages
    education: { primary_or_below: 54, secondary: 29, vocational: 13, university: 4 },
    income: { low: 38, middle: 57, high: 5 },
    urbanization: { urban: 42, suburban: 12, rural: 46 },
  },
  UKR_DON: {
    // The most urban and the only region where Russians are the plurality.
    // Also the oldest workforce: the mines stopped drawing young in-migrants
    // once the seams got deep and the wage premium stopped growing.
    ethnicity: { ukrainian: 52, russian: 46, other: 2 },
    age: { young: 23, mid: 27, mature: 27, senior: 23 },
    education: { primary_or_below: 36, secondary: 32, vocational: 26, university: 6 },
    income: { low: 22, middle: 68, high: 10 },
    urbanization: { urban: 86, suburban: 8, rural: 6 },
  },
  UKR_DNI: {
    ethnicity: { ukrainian: 71, russian: 26, other: 3 },
    age: { young: 24, mid: 28, mature: 26, senior: 22 },
    education: { primary_or_below: 38, secondary: 32, vocational: 23, university: 7 },
    income: { low: 24, middle: 66, high: 10 },
    urbanization: { urban: 76, suburban: 10, rural: 14 },
  },
  UKR_SOU: {
    // Odesa, Mykolaiv, Kherson and Crimea. `other` stays the largest of any
    // region: Bessarabian Bulgarians and Moldovans in the Odesa oblast, and a
    // Crimea resettled after 1944 from across the union. The deported Crimean
    // Tatars are still barred from returning in 1979 and do not appear here.
    ethnicity: { ukrainian: 58, russian: 34, other: 8 },
    age: { young: 24, mid: 28, mature: 26, senior: 22 },
    education: { primary_or_below: 42, secondary: 32, vocational: 18, university: 8 },
    income: { low: 27, middle: 64, high: 9 },
    urbanization: { urban: 66, suburban: 12, rural: 22 },
  },
};
export default uaRegionCensusData;
