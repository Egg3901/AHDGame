/**
 * Poland Layer-1 census (1953, the Bierut Stalinist years), one entry per
 * macro-region. Each dim sums 100.
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly, keyed to the same macro-region codes as the 1979
 * bundle (matching plRegions1953.ts).
 *
 * Key 1953 anchors (vs 1979):
 * - Urbanization is MUCH lower. The 1950 census put Poland at ~39% urban against
 *   ~58% in 1979; the Six-Year Plan's industrial towns (Nowa Huta, Nowe Tychy)
 *   are still building. Only Silesia is already majority-urban.
 * - Education is far thinner: the 1950 census found roughly two thirds of adults
 *   with primary schooling or less and barely 2% with higher education. The
 *   vocational (zawodowe) stream is only just being built out under the plan.
 * - Age skews YOUNG: the postwar baby boom is at its peak and the war removed a
 *   large part of the pre-war mature/senior cohorts.
 * - Income is compressed almost flat — the 1950 currency reform wiped private
 *   savings and wages were administratively levelled.
 * - Ethnicity: postwar Poland is the most homogeneous it has ever been, but the
 *   Recovered Territories (Lower Silesia, Pomerania) are still absorbing
 *   resettled populations, Upper Silesia retains its autochthonous German
 *   remainder, and the east keeps Belarusian/Ukrainian villages — the 1947
 *   Akcja Wisła deportations having only just dispersed the Lemkos westward.
 */
export const plRegionCensusData1953 = {
  PL_MAZ: {
    // Warsaw: still a reconstruction site; the MDM/Old Town rebuild is ongoing
    ethnicity: { polish: 98, minority: 1, other: 1 },
    age: { young: 33, mid: 28, mature: 22, senior: 17 },
    education: { primary_or_below: 62, secondary: 22, vocational: 12, university: 4 },
    income: { low: 40, middle: 56, high: 4 },
    urbanization: { urban: 48, suburban: 12, rural: 40 },
  },
  PL_LOD: {
    // Łódź: the textile city, the postwar interim capital; heavily working-class
    ethnicity: { polish: 98, minority: 1, other: 1 },
    age: { young: 31, mid: 28, mature: 23, senior: 18 },
    education: { primary_or_below: 70, secondary: 19, vocational: 9, university: 2 },
    income: { low: 48, middle: 50, high: 2 },
    urbanization: { urban: 44, suburban: 11, rural: 45 },
  },
  PL_MAL: {
    // Lesser Poland: Kraków plus the new Nowa Huta steelworks town; deeply Catholic
    ethnicity: { polish: 98, minority: 1, other: 1 },
    age: { young: 34, mid: 27, mature: 22, senior: 17 },
    education: { primary_or_below: 68, secondary: 20, vocational: 9, university: 3 },
    income: { low: 46, middle: 51, high: 3 },
    urbanization: { urban: 40, suburban: 11, rural: 49 },
  },
  PL_SLK: {
    // Upper Silesia: the coal and steel core, already the most urban region
    ethnicity: { polish: 93, minority: 6, other: 1 }, // autochthonous German remainder
    age: { young: 33, mid: 29, mature: 22, senior: 16 },
    education: { primary_or_below: 62, secondary: 19, vocational: 17, university: 2 },
    income: { low: 36, middle: 60, high: 4 },
    urbanization: { urban: 60, suburban: 12, rural: 28 },
  },
  PL_DSL: {
    // Lower Silesia: Recovered Territories, still absorbing resettlers from the east
    ethnicity: { polish: 94, minority: 5, other: 1 },
    age: { young: 35, mid: 29, mature: 21, senior: 15 }, // youngest — settler population
    education: { primary_or_below: 68, secondary: 20, vocational: 10, university: 2 },
    income: { low: 48, middle: 50, high: 2 },
    urbanization: { urban: 44, suburban: 12, rural: 44 },
  },
  PL_WLK: {
    // Greater Poland: prosperous commercial farming, pre-war Prussian schooling
    ethnicity: { polish: 98, minority: 1, other: 1 },
    age: { young: 32, mid: 28, mature: 23, senior: 17 },
    education: { primary_or_below: 66, secondary: 22, vocational: 10, university: 2 },
    income: { low: 44, middle: 53, high: 3 },
    urbanization: { urban: 40, suburban: 11, rural: 49 },
  },
  PL_POM: {
    // Pomerania: the shipyard coast, also Recovered Territories resettlement
    ethnicity: { polish: 95, minority: 4, other: 1 },
    age: { young: 35, mid: 28, mature: 22, senior: 15 },
    education: { primary_or_below: 68, secondary: 21, vocational: 9, university: 2 },
    income: { low: 48, middle: 50, high: 2 },
    urbanization: { urban: 40, suburban: 11, rural: 49 },
  },
  PL_EAS: {
    // Eastern Poland: the poorest, most rural, most religious; minority villages
    ethnicity: { polish: 92, minority: 7, other: 1 },
    age: { young: 34, mid: 27, mature: 22, senior: 17 },
    education: { primary_or_below: 78, secondary: 15, vocational: 6, university: 1 },
    income: { low: 60, middle: 39, high: 1 },
    urbanization: { urban: 26, suburban: 9, rural: 65 },
  },
};
export default plRegionCensusData1953;
