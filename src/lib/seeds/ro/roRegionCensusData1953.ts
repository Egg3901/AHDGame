/**
 * Romania Layer-1 census (1953, the Gheorghiu-Dej years), one entry per historic
 * province. ethnicity: romanian (titular) / hungarian / other. Each dim sums 100.
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly, keyed to the same province codes as the 1979
 * bundle (matching roRegions1953.ts).
 *
 * Key 1953 anchors (vs 1979):
 * - Romania is the least urban country in the bloc. The 1948 census put it at
 *   roughly 23% urban against ~48% by 1979; Ceaușescu's systematisation and the
 *   great industrial migration are still two decades away.
 * - Education: the 1948 census recorded roughly a quarter of the population as
 *   illiterate, concentrated in Moldavia and Oltenia; the literacy campaigns are
 *   only just underway, so `primary_or_below` is very high and university tiny.
 * - Age: a young, high-fertility peasant population — abortion is not yet banned
 *   (that comes with Decree 770 in 1966), but rural fertility is high regardless.
 * - Income: near-flat under the first five-year plan; collectivisation began in
 *   1949 and is still contested (armed resistance persists in the Carpathians).
 * - Ethnicity: the Hungarian Autonomous Region is created in 1952, so Transylvania
 *   proper carries an even larger Hungarian share than in 1979; the Banat/Crișana
 *   west still has its full German (Swabian/Saxon) population before the 1970s-80s
 *   emigration, which is why `other` is much heavier there than later.
 */
export const roRegionCensusData1953 = {
  RO_BUC: {
    // Bucharest: the only real metropolis; still a largely commercial city
    ethnicity: { romanian: 93, hungarian: 1, other: 6 },
    age: { young: 28, mid: 29, mature: 24, senior: 19 },
    education: { primary_or_below: 58, secondary: 26, vocational: 12, university: 4 },
    income: { low: 40, middle: 55, high: 5 },
    urbanization: { urban: 82, suburban: 12, rural: 6 },
  },
  RO_MUN: {
    // Wallachia/Muntenia: the Danubian grain plain; Ploiești oil the one exception
    ethnicity: { romanian: 96, hungarian: 1, other: 3 },
    age: { young: 34, mid: 28, mature: 21, senior: 17 },
    education: { primary_or_below: 80, secondary: 14, vocational: 5, university: 1 },
    income: { low: 60, middle: 38, high: 2 },
    urbanization: { urban: 22, suburban: 10, rural: 68 },
  },
  RO_OLT: {
    // Oltenia: the poorest province, smallholder farming, highest illiteracy
    ethnicity: { romanian: 97, hungarian: 1, other: 2 },
    age: { young: 35, mid: 28, mature: 21, senior: 16 },
    education: { primary_or_below: 84, secondary: 11, vocational: 4, university: 1 },
    income: { low: 66, middle: 33, high: 1 },
    urbanization: { urban: 18, suburban: 9, rural: 73 },
  },
  RO_TRA: {
    // Transylvania proper: Hungarian Autonomous Region (1952); Saxon towns
    ethnicity: { romanian: 64, hungarian: 30, other: 6 },
    age: { young: 31, mid: 28, mature: 23, senior: 18 },
    education: { primary_or_below: 68, secondary: 20, vocational: 10, university: 2 },
    income: { low: 48, middle: 49, high: 3 },
    urbanization: { urban: 32, suburban: 11, rural: 57 },
  },
  RO_VST: {
    // Banat/Crișana: the full pre-emigration Swabian population sits in `other`
    ethnicity: { romanian: 70, hungarian: 12, other: 18 },
    age: { young: 29, mid: 28, mature: 24, senior: 19 },
    education: { primary_or_below: 66, secondary: 21, vocational: 11, university: 2 },
    income: { low: 46, middle: 51, high: 3 },
    urbanization: { urban: 34, suburban: 12, rural: 54 },
  },
  RO_MOL: {
    // Moldavia: the most rural and most fertile-in-births province
    ethnicity: { romanian: 95, hungarian: 1, other: 4 },
    age: { young: 36, mid: 28, mature: 20, senior: 16 },
    education: { primary_or_below: 84, secondary: 11, vocational: 4, university: 1 },
    income: { low: 68, middle: 31, high: 1 },
    urbanization: { urban: 18, suburban: 9, rural: 73 },
  },
  RO_DOB: {
    // Dobruja: mixed Turkish/Tatar/Bulgarian coast; Constanța port
    ethnicity: { romanian: 84, hungarian: 1, other: 15 },
    age: { young: 33, mid: 28, mature: 22, senior: 17 },
    education: { primary_or_below: 76, secondary: 16, vocational: 6, university: 2 },
    income: { low: 56, middle: 42, high: 2 },
    urbanization: { urban: 30, suburban: 11, rural: 59 },
  },
};
export default roRegionCensusData1953;
