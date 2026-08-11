/**
 * Yugoslavia Layer-1 census (1953), one entry per federal unit. ethnicity:
 * south_slav (all titular Yugoslav nations) / albanian / other. Each dim sums 100.
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly, keyed to the same federal-unit codes as the 1979
 * bundle (matching yuRegions1953.ts).
 *
 * Note: Yugoslavia is NOT a Warsaw-Pact member — it has been outside the bloc
 * since the 1948 Tito-Stalin split, is taking American aid, and abandons forced
 * collectivisation outright in 1953 in favour of workers' self-management. The
 * model still uses the shared command-economy archetypes, but the country's
 * seed elsewhere carries its non-aligned stance.
 *
 * Key 1953 anchors (vs 1979):
 * - The actual 1953 census: ~17 million people, roughly 60% of the workforce
 *   still in agriculture, and a national urban share around 22%. The north-west
 *   (Slovenia, Croatia) is already visibly ahead of the south — the development
 *   gap that eventually breaks the federation is present from the start.
 * - Kosovo is the outlier on every axis: the highest fertility in Europe, the
 *   lowest literacy, and the most rural population in the country.
 * - Education: mass illiteracy in Bosnia, Kosovo, Macedonia and Montenegro; the
 *   1953 census put national illiteracy at roughly a quarter of the population.
 * - Ethnicity: the 1953 census offered a "Yugoslav-undeclared" option and the
 *   Vojvodina Germans have been expelled, so Vojvodina's `other` — Hungarians,
 *   Romanians, Slovaks, Ruthenes — is smaller than the pre-war mix but still the
 *   most plural unit in the federation.
 */
export const yuRegionCensusData1953 = {
  YU_SLO: {
    // Slovenia: the most developed republic even in 1953
    ethnicity: { south_slav: 97, albanian: 0, other: 3 },
    age: { young: 27, mid: 28, mature: 25, senior: 20 },
    education: { primary_or_below: 62, secondary: 24, vocational: 11, university: 3 },
    income: { low: 32, middle: 58, high: 10 },
    urbanization: { urban: 32, suburban: 16, rural: 52 },
  },
  YU_CRO: {
    // Croatia: Zagreb and the Adriatic coast; interior still smallholder
    ethnicity: { south_slav: 96, albanian: 0, other: 4 },
    age: { young: 28, mid: 28, mature: 24, senior: 20 },
    education: { primary_or_below: 70, secondary: 20, vocational: 8, university: 2 },
    income: { low: 40, middle: 54, high: 6 },
    urbanization: { urban: 26, suburban: 14, rural: 60 },
  },
  YU_BIH: {
    // Bosnia-Herzegovina: mountain villages, mass illiteracy, very high fertility
    ethnicity: { south_slav: 96, albanian: 1, other: 3 },
    age: { young: 38, mid: 27, mature: 20, senior: 15 },
    education: { primary_or_below: 86, secondary: 10, vocational: 3, university: 1 },
    income: { low: 62, middle: 36, high: 2 },
    urbanization: { urban: 14, suburban: 12, rural: 74 },
  },
  YU_SRB: {
    // Serbia proper: Belgrade plus the Šumadija smallholder heartland
    ethnicity: { south_slav: 95, albanian: 2, other: 3 },
    age: { young: 31, mid: 28, mature: 23, senior: 18 },
    education: { primary_or_below: 76, secondary: 16, vocational: 6, university: 2 },
    income: { low: 50, middle: 46, high: 4 },
    urbanization: { urban: 24, suburban: 14, rural: 62 },
  },
  YU_VOJ: {
    // Vojvodina: the federation's grain belt and its most plural unit
    ethnicity: { south_slav: 72, albanian: 0, other: 28 },
    age: { young: 27, mid: 28, mature: 25, senior: 20 },
    education: { primary_or_below: 72, secondary: 19, vocational: 7, university: 2 },
    income: { low: 42, middle: 53, high: 5 },
    urbanization: { urban: 24, suburban: 14, rural: 62 },
  },
  YU_KOS: {
    // Kosovo: the poorest and youngest region in Europe
    ethnicity: { south_slav: 27, albanian: 69, other: 4 },
    age: { young: 48, mid: 25, mature: 16, senior: 11 },
    education: { primary_or_below: 92, secondary: 6, vocational: 1, university: 1 },
    income: { low: 76, middle: 23, high: 1 },
    urbanization: { urban: 12, suburban: 8, rural: 80 },
  },
  YU_MNE: {
    // Montenegro: clan-village society, heavy Partisan-veteran cadre presence
    ethnicity: { south_slav: 91, albanian: 7, other: 2 },
    age: { young: 38, mid: 27, mature: 20, senior: 15 },
    education: { primary_or_below: 82, secondary: 13, vocational: 4, university: 1 },
    income: { low: 64, middle: 34, high: 2 },
    urbanization: { urban: 16, suburban: 10, rural: 74 },
  },
  YU_MKD: {
    // Macedonia: tobacco smallholdings; Albanian west; Skopje pre-earthquake
    ethnicity: { south_slav: 70, albanian: 22, other: 8 },
    age: { young: 40, mid: 27, mature: 19, senior: 14 },
    education: { primary_or_below: 86, secondary: 10, vocational: 3, university: 1 },
    income: { low: 68, middle: 30, high: 2 },
    urbanization: { urban: 18, suburban: 10, rural: 72 },
  },
};
export default yuRegionCensusData1953;
